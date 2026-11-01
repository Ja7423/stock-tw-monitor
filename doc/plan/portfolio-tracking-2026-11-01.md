# Feature Plan：台股持股追蹤

| 項目 | 內容 |
|------|------|
| 規劃日期 | 2026-11-01 |
| 規劃方式 | grilling（4 輪，Q1–Q27） |
| 目前分支 | `master`（實作時開 `feature/portfolio-tracking`） |
| 狀態 | 已確認，已實作（`feature/portfolio-tracking`） |

## 需求摘要

在現有的 Telegram bot 加入持股追蹤：記錄買賣與股利（可補登過去日期、可分批），用移動加權平均動態計算成本，提供持股清單與淨值加總、個股明細（成本、報酬、交易時點、已實現報酬）、未實現報酬率趨勢，並在每日推播附上持股摘要。持股和監測清單的分析參數（range / ma / pct）完全無關。

### 範圍

- **In scope**：`/buy`、`/sell`、`/div`、`/tradedel`、`/holdings`、`/pos`、`/trend`；手續費 / 證交稅自動計算與全域設定；每日推播附持股摘要與今日損益；每日 sync 範圍擴大為「監測清單 ∪ 目前持股」；`/status` 顯示每日同步檔數與每次排程的請求量估計；文件更新。
- **Out of scope**：融資融券、當沖、盤中即時價、減資 / 分割 / 換股、從 FinMind 自動帶入股利、編輯單筆交易、已出清股票的獨立清單指令、圖片圖表、時間加權報酬率。

## 決策紀錄

| # | 決策 | 選擇 | 理由 / 被放棄的選項 |
|---|------|------|------|
| D1 | 持股與監測清單的關係 | 完全獨立；買進不會自動 `/add` | Q1。監測不一定有買進，持股也不一定要監測 |
| D2 | 價格快取 | 共用 `daily_prices`；`/del` 和 600 天清除跳過有交易紀錄的股票 | Q1。不共用的話，同一檔要存兩份日 K |
| D3 | 估值價格 | 最近一個交易日的收盤價，標出資料日 | Q2。盤中即時價需要 FinMind 付費方案和盤中 cron |
| D4 | 手續費與稅 | 依全域設定自動計算，每筆可用 `fee=` / `tax=` 覆寫 | Q3。被放棄：不算（和對帳單差太多）、每筆手動輸入（太麻煩） |
| D5 | 手續費公式 | `max(⌊金額 × 0.1425% × 折扣⌋, 最低)`；股數 < 1000 時用零股最低收費 | Q11。都用無條件捨去 |
| D6 | 手續費預設值 | 國泰：折扣 0.28、整股最低 1、零股最低 1；成本用折讓後的金額 | Q11。資料來自沒有標日期的第三方整理表，使用者要拿對帳單核對 |
| D7 | 證交稅 | 股票 0.3%、`00` 開頭的 ETF 0.1%、`00…B` 債券 ETF 0% | Q11。其他特例（ETN、停徵期限變動）用 `tax=` 覆寫 |
| D8 | 手續費在交易當下就計算並存進資料表 | 存 `fee`、`tax` 實際值 | 預設值。之後改 `/set fee` 不會改到過去的交易 |
| D9 | 成本計算 | 移動加權平均，均價含買進手續費；賣出時均價不變；歸零後重算 | Q4、Q12。被放棄：FIFO |
| D10 | 數量單位 | 只接受「股」，支援零股 | Q5 |
| D11 | 交易時間精度 | 只到日期，預設今天；同一天依輸入順序（`id`） | Q6 |
| D12 | 持股狀態 | 不存狀態，每次從交易紀錄重新計算（event replay） | Q6。補登和刪除會自動更正均價、已實現報酬和趨勢 |
| D13 | 更正方式 | 只能 `/tradedel <編號>`，不另外確認，回覆被刪的內容 | Q7、Q10 |
| D14 | 異常處理 | 賣超，或補登 / 刪除後歷史上某天股數變負，就拒絕並回覆是哪一天 | Q8 |
| D15 | 範圍 | 只做現股；股利手動記錄 | Q9 |
| D16 | 指令 | `/buy`、`/sell`、`/div`、`/tradedel`、`/holdings`、`/pos`、`/trend`，不另外做 `/nav` | Q10 |
| D17 | 日期格式 | `2026-10-15` 或 `10/15`（今年） | Q10 |
| D18 | 淨值 | 市值 − 預估賣出手續費 − 預估證交稅（用目前的費率設定） | Q12 |
| D19 | 未實現報酬率 | (淨值 − 持有成本) ÷ 持有成本 | Q12 |
| D20 | 現金股利 | 輸入入帳總額，日期用入帳日，算進已實現報酬 | Q13 |
| D21 | 股票股利 | 輸入配到的股數，日期用除權日，以 0 成本加入持股 | Q13 |
| D22 | 趨勢 | 即時從交易紀錄 + `daily_prices` 計算，不存快照 | Q14 |
| D23 | 每日 sync 範圍 | 監測清單 ∪ 目前股數大於 0 的持股，同一檔只抓一次 | Q14、Q19 |
| D24 | 檔數門檻 | 合計超過 40 檔時，`/add`、`/buy` 只警告、不阻擋 | Q19、Q26。Worker 免費方案每次執行約 50 個對外請求 |
| D25 | `/buy` 時 FinMind 查詢失敗 | 從來沒出現過的股票就拒絕；已知的股票不呼叫 FinMind；回補日 K 失敗時交易照樣成立 | Q20 |
| D26 | `/holdings` 排序 | 依淨值從大到小 | Q21 |
| D27 | `/pos` | 全部交易紀錄依日期排序，太長就拆成多則；賣出那一行顯示該筆損益；已出清的股票也能查 | Q17、Q22 |
| D28 | 今日損益 | 今天的總損益 −（上一個交易日的總損益），總損益 = 未實現 + 累計已實現 | Q23 |
| D29 | `/trend` | 一行未實現報酬率的 sparkline，加上每 5 個交易日一列（報酬率、未實現損益、總損益、淨值），不顯示最高和最低；預設 60 個交易日 | Q15、Q24 |
| D30 | 每日推播 | 報告送出後，接著送持股摘要和今日損益；`no_data` 時不發；監測清單是空的、但有持股時仍然發；手動 `/report` 也發 | Q16、Q27 |
| D31 | 減資 / 分割 / 換股 | 不支援，文件說明怎麼用一賣一買手動調整 | Q25 |
| D32 | 未來日期 | 拒絕；過去的日期都接受，不檢查是不是交易日 | Q18 |
| D33 | 請求量統計 | `/status` 多一行：每日同步檔數，以及每次排程的對外請求估計值 | Q26。「統計每日 api 請求量」解讀成在 `/status` 顯示，可推翻 |
| D34 | 股票名稱 | 新增 `stock_info` 表，記錄有交易紀錄的股票名稱 | 預設值。持股不一定在 watchlist，名稱要有地方存 |
| D35 | 指令分派 | `bot.ts` 的 `switch` 改成 handler map | 預設值。加 7 個 case 後，循環複雜度會超過 15 |

## 現況分析

- **最相似的既有功能**：`/add`（`src/bot.ts` `handleAdd`）：驗證代號 → 查 FinMind 名稱 → 寫 D1 → 回補日 K，失敗時回 `⚠️ 已新增，歷史資料稍後補抓`。`/buy` 照這個流程和回覆風格。
- **可重用**：
  - `src/config.ts` 的 `STOCK_ID_RE`、`parseIntInRange` 的錯誤訊息風格
  - `src/bot.ts` 的 `parseStockIds`
  - `src/job.ts` 的 `syncStock`、`taipeiDate`、`shiftDate`、`syncAll` 的額度處理
  - `src/finmind.ts` 的 `fetchStockInfo`、`fetchDailyBars`（`start_date` 一次抓到今天）
  - `src/report.ts` `formatReport` 裡的訊息拆分邏輯：抽出成共用的 `splitMessages`
  - `src/report.ts` 的 `fmtPrice`、`fmtSigned`、`fmtPct`：抽到共用的 `src/format.ts`
  - `settings` 表（key/value）存手續費設定
- **需新增的資料來源**：`trades`、`stock_info` 兩張表（`migrations/0002_portfolio.sql`）。不需要新的 FinMind dataset。
- **會被影響的既有程式碼**：
  - `src/db.ts` `removeStock`、`pruneBarsBefore`：改成跳過有交易紀錄的股票
  - `src/job.ts` `runReport`：sync 範圍、空清單的處理、附上持股摘要
  - `src/bot.ts`：指令分派、`/set` 支援手續費 key、`/add` 的檔數警告
  - `src/commands.ts`：新增「持股」群組、`/set` 用法
  - `src/status.ts`：同步量那一行
  - `doc/bot-usage.md`、`doc/architecture.md`、`doc/html/index.html`（`npm run docs:html`）

### 目前已知的每日 API 請求量（Q26，2026-11-01 查 production D1）

監測清單 2 檔（2330、5274），持股 0。

| 時機 | FinMind | Telegram | 每次執行的對外請求 |
|------|---------|----------|------|
| 15:00 cron | ≤ 2（`TaiwanStockPrice`，已有當天 K 棒的股票會跳過） | 1（有當天資料才送） | ≤ 3 / 50 |
| 16:00 cron（15:00 沒推播成功才會跑） | ≤ 2 | 1 | ≤ 3 / 50 |
| 每天合計 | ≤ 4 / 每小時 600 | ≤ 2 | — |
| `/add` 每檔 | 2（Info + 回補） | 1 則回覆 | — |
| `/status` | 1（`user_info`，不算額度） | 1 | — |

功能上線後，每次排程的請求數 ≈ 同步檔數 U（監測 ∪ 持股）+ 報告訊息數（約每 10 檔一則）+ 持股摘要訊息數（約每 40 檔一則）。FinMind 每天 ≤ 2U。`/holdings`、`/pos`、`/trend` 只讀 D1，不呼叫 FinMind。真正的瓶頸是 Worker 每次執行約 50 個對外請求的上限，不是 FinMind 額度，大約 U ≈ 40 時會碰到。

## 架構設計

```
index.ts
  └─ bot.ts（handler map）
       ├─ portfolioBot.ts（/buy /sell /div /tradedel /holdings /pos /trend）
       │    ├─ tradeArgs.ts（解析參數，純）
       │    ├─ fees.ts（手續費 / 稅，純）
       │    ├─ portfolio.ts（replay、估值、趨勢，純）
       │    ├─ portfolioReport.ts（文字格式，純）
       │    ├─ portfolioDb.ts（trades / stock_info）
       │    └─ job.ts ensureHistory（回補日 K）
       └─ status.ts（多一行同步量）
  └─ job.ts runReport
       ├─ syncTargets（監測 ∪ 持股，純）
       ├─ formatReport → message.ts splitMessages
       └─ portfolioBot.buildHoldingsSummary → portfolioReport.formatDailySummary
```

和現有的四層一致：

- **流程** `portfolioBot.ts`：串接 D1、FinMind 和純邏輯，不放計算。`bot.ts` 只負責分派。持股的 handler 獨立成一個檔案，避免 `bot.ts` 同時管監測和持股兩個領域。
- **純邏輯** `portfolio.ts`、`fees.ts`、`tradeArgs.ts`、`portfolioReport.ts`、`message.ts`、`format.ts`：輸入資料、回傳結果，所有單元測試都集中在這層。
- **外部服務** `portfolioDb.ts`：只放 `trades`、`stock_info` 的 SQL。手續費設定放在 `db.ts`，因為和其他全域設定一樣存在 `settings` 表。

### 持股計算（event replay）

```
trades（依 trade_date, id 排序）
  → reduce(applyTrade) → PositionState { shares, cost, realizedTrading, realizedDividend, entries[] }
```

`applyTrade` 用 `Record<TradeType, Reducer>` 分派。之後要加減資或分割時，只需要新增一個 type、一個 reducer、一行標籤和解析器，不必去改既有的分支。

- 買進：`shares += n`，`cost += price × n + fee`
- 賣出：`costOut = cost × n / shares`，`realized = price × n − fee − tax − costOut`，`cost -= costOut`，`shares -= n`；股數歸零時 `cost = 0`
- 股票股利：`shares += n`，`cost` 不變
- 現金股利：`realizedDividend += amount`
- 股數小於 0：回傳 `{ ok: false, date }`，不丟例外，讓呼叫端決定要怎麼回覆

### 趨勢計算

`buildTrend(trades, barsByStock, days, feeConfig)`：

- 交易日 = 有交易紀錄的股票在 `daily_prices` 裡的日期聯集，從第一筆交易那天開始，取最後 N 天。
- 對每個日期，用指標往前推進 replay，收盤價取「≤ 該日的最後一根 K 棒」（停牌時沿用最後的收盤價）。
- 持股成本是 0 的日期，報酬率記為 `null`。
- 今日損益和 `/trend` 用同一個函式：`buildTrend(..., 2)`，取最後兩點的 `totalPnl` 相減。

### 日 K 覆蓋範圍

- 每日 sync 用既有的 `syncStock`，只往後增量抓。
- 新增 `ensureHistory(env, stockId, from, today)`：沒有任何 K 棒，或最早的 K 棒晚於 `from` 時，從 `from` 抓到今天（1 次請求）；否則交給 `syncStock`。`/add` 用 `from = today − 420`，`/buy`、`/sell`、`/div` 用 `from = 交易日`。這樣也處理了「先持有、之後才 `/add`」的情況：只有交易日之後的 K 棒，不夠算 MA240。

### 替代方案

| 方案 | 優點 | 缺點 | 結論 |
|------|------|------|------|
| 存 `positions` 狀態表，交易時更新 | 查詢快 | 補登 / 刪除時要重算後面每一筆，容易跟交易紀錄不一致 | 不採用（D12） |
| 每日快照表 | 保留當天看到的數字 | 補登要重建快照，多一張表和一條寫入路徑 | 不採用（D22） |

## 檔案變更清單

| 動作 | 檔案 | 層 | 職責 |
|------|------|----|------|
| 新增 | `migrations/0002_portfolio.sql` | Schema | `trades`、`stock_info`；手續費預設值寫入 `settings` |
| 新增 | `src/portfolio.ts` | 純邏輯 | `replayTrades`、`valuePosition`、`summarizePortfolio`、`buildTrend` |
| 新增 | `src/fees.ts` | 純邏輯 | `FeeConfig`、`DEFAULT_FEE_CONFIG`、`calcFee`、`calcTax`、`taxRateFor`、`parseFeePatch`、`describeFeeConfig` |
| 新增 | `src/tradeArgs.ts` | 純邏輯 | `parseTradeArgs`、`parseDividendArgs`、`parseTradeDate`、`parseTrendArgs` |
| 新增 | `src/portfolioReport.ts` | 純邏輯 | `formatHoldings`、`formatPosition`、`formatTrend`、`formatDailySummary`、`formatTradeLine`、`sparkline` |
| 新增 | `src/message.ts` | 純邏輯 | `splitMessages(blocks, separator)`，從 `formatReport` 抽出 |
| 新增 | `src/format.ts` | 純邏輯 | `fmtPrice`、`fmtSigned`、`fmtPct`、`fmtMoney`，從 `report.ts` 抽出 |
| 新增 | `src/portfolioDb.ts` | 外部服務 | trades CRUD、`stock_info`、`listHeldStockIds`、`getBarsSince` |
| 新增 | `src/portfolioBot.ts` | 流程 | 7 個持股指令的 handler，以及給 `runReport` 用的 `buildHoldingsSummary` |
| 修改 | `src/types.ts` | 型別 | `TradeType`、`Trade`、`NewTrade` |
| 修改 | `src/db.ts` | 外部服務 | `getFeeConfig`、`setFeeConfig`、`getDateRange`；`removeStock` 和 `pruneBarsBefore` 跳過有交易紀錄的股票 |
| 修改 | `src/job.ts` | 流程 | `ensureHistory`、`syncTargets`、sync 範圍、空清單的處理、附持股摘要 |
| 修改 | `src/bot.ts` | 流程 | handler map；`/set` 支援 `fee`、`feemin`、`feeminodd`；`/add` 改用 `ensureHistory` 並加檔數警告；`/settings` 顯示手續費 |
| 修改 | `src/report.ts` | 純邏輯 | 改用 `splitMessages`、`format.ts` |
| 修改 | `src/status.ts` | 純邏輯 | `formatSyncLoad`、`estimateRunRequests` |
| 修改 | `src/config.ts` | 純邏輯 | `SYNC_WARN_STOCKS = 40` |
| 修改 | `src/commands.ts` | 純邏輯 | 「持股」群組、`/set` 用法 |
| 新增 | `test/portfolio.test.ts`、`test/fees.test.ts`、`test/tradeArgs.test.ts`、`test/portfolioReport.test.ts`、`test/message.test.ts` | 測試 | 見測試計畫 |
| 修改 | `test/commands.test.ts`、`test/status.test.ts`、`test/report.test.ts` | 測試 | 新指令、同步量那一行、拆分行為不變 |
| 修改 | `doc/bot-usage.md`、`doc/architecture.md`、`doc/html/index.html` | 文件 | 新指令、計算方式、模組圖、ER 圖、每日流程 |

## 介面草案

```sql
-- migrations/0002_portfolio.sql
CREATE TABLE trades (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_id   TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('buy', 'sell', 'cash_dividend', 'stock_dividend')),
  trade_date TEXT NOT NULL,              -- YYYY-MM-DD
  shares     INTEGER NOT NULL DEFAULT 0, -- 買賣與股票股利的股數；現金股利為 0
  price      REAL,                       -- 買賣成交價；股利為 NULL
  amount     INTEGER NOT NULL DEFAULT 0, -- 現金股利入帳金額
  fee        INTEGER NOT NULL DEFAULT 0,
  tax        INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX trades_stock_date ON trades (stock_id, trade_date, id);

-- 有交易紀錄的股票名稱；持股不一定在 watchlist 裡
CREATE TABLE stock_info (
  stock_id TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  market   TEXT
);

INSERT INTO settings (key, value) VALUES
  ('fee_discount', '0.28'),
  ('fee_min', '1'),
  ('fee_min_odd', '1');
```

```ts
// types.ts
export type TradeType = "buy" | "sell" | "cash_dividend" | "stock_dividend";

export interface Trade {
  id: number;
  stockId: string;
  type: TradeType;
  date: string; // YYYY-MM-DD
  shares: number;
  price: number | null;
  amount: number;
  fee: number;
  tax: number;
}

export type NewTrade = Omit<Trade, "id">;
```

```ts
// fees.ts
export interface FeeConfig {
  discount: number;  // 0.28 = 2.8 折
  minFee: number;    // 整股最低手續費
  minFeeOdd: number; // 零股（股數 < 1000）最低手續費
}
export const DEFAULT_FEE_CONFIG: FeeConfig;
export const FEE_RATE = 0.001425;
export function taxRateFor(stockId: string): number;
export function calcFee(amount: number, shares: number, cfg: FeeConfig): number;
export function calcTax(stockId: string, amount: number): number;
/** 解析 /set fee 0.28、/set feemin 20、/set feeminodd 1；不是手續費的 key 回傳 null */
export function parseFeePatch(key: string, value: string): Partial<FeeConfig> | null;
export function describeFeeConfig(cfg: Partial<FeeConfig>): string;
```

```ts
// tradeArgs.ts
export interface TradeArgs {
  stockId: string;
  shares: number;
  price: number;
  date: string;
  fee?: number; // 有給就覆寫自動計算的值
  tax?: number;
}
/** /buy、/sell：代號 股數 價格 [日期] [fee=] [tax=]；未來日期丟錯 */
export function parseTradeArgs(args: string[], today: string): TradeArgs;
export type DividendArgs =
  | { stockId: string; kind: "cash"; amount: number; date: string }
  | { stockId: string; kind: "stock"; shares: number; date: string };
export function parseDividendArgs(args: string[], today: string): DividendArgs;
/** 2026-10-15 或 10/15（今年） */
export function parseTradeDate(raw: string, today: string): string;
export function parseTrendArgs(args: string[]): { stockId?: string; days: number };
```

```ts
// portfolio.ts
export interface TradeEntry {
  trade: Trade;
  realized: number | null; // 賣出時該筆的損益，其他類型為 null
}
export interface PositionState {
  shares: number;
  cost: number;             // 持有成本，含買進手續費
  realizedTrading: number;  // 累計價差損益
  realizedDividend: number; // 累計現金股利
  entries: TradeEntry[];
}
export type ReplayResult =
  | { ok: true; position: PositionState }
  | { ok: false; negativeOn: string }; // 哪一天股數變負

/** trades 需為同一檔股票；會依 (date, id) 排序後重算，不修改傳入的陣列 */
export function replayTrades(trades: readonly Trade[]): ReplayResult;
export function avgCost(p: PositionState): number | null;

export interface PositionValue {
  close: number;
  closeDate: string;
  marketValue: number;
  netValue: number; // 扣預估賣出手續費和證交稅
  unrealized: number;
  unrealizedPct: number | null;
}
export function valuePosition(stockId: string, p: PositionState, close: Bar, fee: FeeConfig): PositionValue;

export interface PortfolioTotals {
  cost: number;
  marketValue: number;
  netValue: number;
  unrealized: number;
  unrealizedPct: number | null;
  realizedTrading: number;
  realizedDividend: number;
}
export function summarizePortfolio(rows: { position: PositionState; value: PositionValue | null }[]): PortfolioTotals;

export interface TrendPoint {
  date: string;
  netValue: number;
  unrealized: number;
  unrealizedPct: number | null;
  totalPnl: number; // 未實現 + 累計已實現（含股利）
}
export function buildTrend(
  trades: readonly Trade[],
  barsByStock: ReadonlyMap<string, readonly Bar[]>,
  days: number,
  fee: FeeConfig,
): TrendPoint[];
export function dailyPnl(points: readonly TrendPoint[]): number | null;
```

```ts
// portfolioReport.ts
export interface HoldingRow {
  stockId: string;
  name: string;
  position: PositionState;
  value: PositionValue | null;
}
export function formatHoldings(rows: HoldingRow[], totals: PortfolioTotals, today: string): string[];
export function formatPosition(stockId: string, name: string, p: PositionState, value: PositionValue | null): string[];
export function formatTrend(title: string, points: TrendPoint[], step?: number): string;
export function formatDailySummary(rows: HoldingRow[], totals: PortfolioTotals, todayPnl: number | null, today: string): string[];
export function sparkline(values: number[]): string;
```

```ts
// message.ts
export const TELEGRAM_LIMIT = 4000;
/** 依 Telegram 長度上限把 blocks 切成多則訊息，不拆開單一 block */
export function splitMessages(blocks: string[], separator?: string): string[];
```

```ts
// portfolioDb.ts
export async function listTrades(db: D1Database, stockId?: string): Promise<Trade[]>;
export async function getTrade(db: D1Database, id: number): Promise<Trade | null>;
export async function insertTrade(db: D1Database, trade: NewTrade): Promise<number>;
export async function deleteTrade(db: D1Database, id: number): Promise<boolean>;
/** 股數（買進 + 股票股利 − 賣出）大於 0 的股票 */
export async function listHeldStockIds(db: D1Database): Promise<string[]>;
export async function getStockName(db: D1Database, stockId: string): Promise<string | null>; // 先查 stock_info，再查 watchlist
export async function upsertStockInfo(db: D1Database, stockId: string, name: string, market: string | null): Promise<void>;
export async function getBarsSince(db: D1Database, stockIds: string[], from: string): Promise<Map<string, Bar[]>>;
```

```ts
// job.ts
export async function ensureHistory(env: Env, stockId: string, from: string, today: string): Promise<void>;
/** 監測 ∪ 持股，去重並保持監測清單在前 */
export function syncTargets(watchIds: string[], heldIds: string[]): string[];
```

```ts
// status.ts
export interface SyncLoad {
  watch: number;
  held: number;
  total: number; // 去重後
}
export function estimateRunRequests(load: SyncLoad): number;
export function formatStatus(today: string, run: JobRun | null, quota: FinMindQuota | Error, load: SyncLoad): string;
```

```ts
// bot.ts
type CommandHandler = (env: Env, args: string[], chatId: number) => Promise<string | null>;
const HANDLERS: Record<string, CommandHandler>;
```

## 規則檢核（pre-review）

| 規則 | 設計對策 | 殘留風險 |
|------|----------|----------|
| 1. 框架慣例 | 照 `architecture.md` 的四層：計算和格式放純邏輯檔，SQL 只在 `*Db.ts`，HTTP 只在 `finmind.ts`、`telegram.ts`。指令清單只從 `commands.ts` 產生（`/help`、選單）。SQL 全部用 `prepare().bind()`。回覆用純文字，錯誤訊息照 `handleAdd` 的 `✅ ➖ ⚠️ ❌` 風格。Schema 走 `migrations/0002_*.sql`，部署時由 CI 套用 | 無 |
| 2. 架構可擴充性 | 交易類型用 `Record<TradeType, Reducer>` 和 `Record<TradeType, string>` 標籤分派，新增減資或分割只要新增一筆。持股 handler 獨立在 `portfolioBot.ts`，不塞進監測流程。門檻（40 檔、60 天、每 5 天一列）都是具名常數。不做只有一種實作的介面（例如 price provider） | 無 |
| 3. 副作用 / Pure Function | `replayTrades`、`buildTrend`、`valuePosition`、`calcFee`、`parseTradeArgs` 都是純函式，不修改傳入的陣列（`readonly`，排序前先複製）。「今天」一律由呼叫端傳入 `today`（來自 `taipeiDate(new Date())`），純函式裡不呼叫 `Date.now()`。負數股數回傳結果，不丟例外 | 無 |
| 4. 重複程式碼 | 抽出 `splitMessages` 和 `format.ts`，報告和持股共用。估值和交易當下的費用都用同一組 `calcFee` / `calcTax`。今日損益重用 `buildTrend`。`/add` 和 `/buy` 共用 `ensureHistory`。代號驗證重用 `STOCK_ID_RE` / `parseStockIds` | 無 |
| 5. 命名 | 名詞一致：trade（一筆紀錄）、position（某檔的持股狀態）、portfolio（全部持股）、netValue（淨值）、realized / unrealized、totalPnl。`replayTrades` 表示「從事件重算」，`ensureHistory` 表示「確保覆蓋到某日」，`syncStock` 維持原本的意思（增量） | 無 |
| 6. 巢狀與複雜度 | `bot.ts` 的 `switch` 改成 handler map，`handleUpdate` 的複雜度會從約 14 降到約 4。replay 的分支放在各個 reducer。`buildTrend` 拆成 `tradingDays`、`closeOn`、`pointOn` 三個子函式。參數解析每種指令一個函式，`fee=` / `tax=` 用 key map 解析 | `buildTrend` 的雙指標迴圈要注意巢狀 ≤ 4 |
| 7. SOLID | S：`portfolio.ts` 只算、`portfolioReport.ts` 只排版、`portfolioDb.ts` 只存取。O：見規則 2。L：沒有繼承。I：`portfolioDb.ts` 只放持股需要的函式，不擴大 `db.ts`。D：照專案的既有方式，I/O 函式接收 `env` / `db` 參數，純函式只吃資料 | 無 |

## 實作步驟

1. **抽出共用工具** — 動到：`src/message.ts`、`src/format.ts`、`src/report.ts`、`test/message.test.ts`；驗證：`npm test`（`report.test.ts` 不用改就要通過）、`npm run typecheck`
2. **Schema 與型別** — 動到：`migrations/0002_portfolio.sql`、`src/types.ts`；驗證：`npm run db:migrate:local`
3. **手續費** — 動到：`src/fees.ts`、`test/fees.test.ts`；驗證：`npm test`
4. **持股計算** — 動到：`src/portfolio.ts`、`test/portfolio.test.ts`（replay、估值、趨勢、今日損益）；驗證：`npm test`
5. **參數解析** — 動到：`src/tradeArgs.ts`、`test/tradeArgs.test.ts`；驗證：`npm test`
6. **文字格式** — 動到：`src/portfolioReport.ts`、`test/portfolioReport.test.ts`；驗證：`npm test`
7. **D1 存取** — 動到：`src/portfolioDb.ts`、`src/db.ts`（手續費設定、`getDateRange`、`removeStock` / `pruneBarsBefore` 排除）；驗證：`npm run typecheck`
8. **流程** — 動到：`src/job.ts`（`ensureHistory`、`syncTargets`、`runReport`）、`src/portfolioBot.ts`、`src/bot.ts`（handler map、`/set`、`/add` 警告、`/settings`）、`src/status.ts`、`src/config.ts`、`src/commands.ts`；驗證：`npm test`、`npm run typecheck`
9. **本機端對端** — `npm run dev` 搭配本機 D1，用 curl 模擬 webhook：buy → 補登 buy → sell → div → holdings → pos → trend → tradedel（會變負數的那一筆要被拒絕）；`curl "http://localhost:8787/__scheduled?cron=0+7+*+*+*"` 確認報告後面有持股摘要
10. **文件** — 動到：`doc/bot-usage.md`（新指令、計算方式、手動調整減資的範例）、`doc/architecture.md`（模組圖、ER 圖、每日流程、請求量）；驗證：`npm run docs:html`

## 測試計畫

- `portfolio.test.ts`
  - 分批買進的均價含手續費；賣出後均價不變、已實現損益正確
  - 歸零後再買進，均價從頭算
  - 補登一筆比較早的買進，均價和後面賣出的損益都跟著變
  - 同一天多筆依 `id` 排序
  - 賣超回傳 `negativeOn`；刪掉一筆買進後，負數出現在後面某一天
  - 股票股利讓均價下降；現金股利只影響 `realizedDividend`
  - `valuePosition` 的淨值有扣賣出費用和稅
  - `buildTrend` 停牌時沿用最後收盤價、持股為 0 的日期 `unrealizedPct` 是 `null`、只取最後 N 天
  - `dailyPnl` 當天有買進時不會把投入的資金算成獲利
- `fees.test.ts`：最低手續費（整股 / 零股）、無條件捨去、`00` ETF 0.1%、`00679B` 0%、一般股票 0.3%、`parseFeePatch` 的範圍檢查和未知 key
- `tradeArgs.test.ts`：缺參數、股數非正整數、價格非正數、`10/15` 轉成今年、未來日期拒絕、`fee=` / `tax=` 覆寫、未知參數、`/div cash` 和 `/div stock`
- `portfolioReport.test.ts`：`/holdings` 依淨值排序、資料日標示、總計段；`/pos` 已出清的股票、賣出那一行有損益；`/trend` 每 5 天一列且最後一列是最新的一天；`sparkline` 全部相同值時不會除以 0；長內容會拆成多則
- `status.test.ts`：同步量那一行和估計值
- `commands.test.ts`：新指令出現在 `/help` 和選單

## 風險與未決問題

- ⚠️ **cron 星期設定錯誤（和這個功能無關，但影響每日推播）**：Cloudflare cron 的星期是 1 = 星期日、7 = 星期六（[官方文件](https://developers.cloudflare.com/workers/configuration/cron-triggers/)），所以 `wrangler.toml` 的 `0 7 * * 1-5` 實際上是**週日到週四**，週五不會推播。production `job_runs` 有一筆 `2026-11-01`（星期日）08:00 UTC 的 `no_data`，可以佐證。✅ 已在這個功能之前另外修正：`wrangler.toml` 改成 `mon-fri`。
- ⚠️ **國泰的費率還沒驗證**：預設值來自沒有標日期的第三方整理表（2.8 折、最低 1 元、日退）。請拿一張對帳單核對，不對的話用 `/set` 修正。已經存進資料表的交易不會被新設定改到（D8）。
- ⚠️ **債券 ETF 停徵證交稅的期限**：停徵是有期限的政策，期滿後 `taxRateFor` 要改，或者用 `tax=` 覆寫。
- ⚠️ **檔數上限**：U > 約 45 時，排程可能碰到 Worker 對外請求的上限，報告送不出去。目前只有警告（D24），沒有阻擋或分批處理。
- ⚠️ **淨值用目前的費率**：趨勢裡過去日期的淨值，用的是現在的費率設定，不是當時的設定，差異很小。
- ❓ **D33 的解讀**：「統計每日 api 請求量」我做成 `/status` 多一行估計值，也在這份計畫裡列了目前的實際數字。如果你要的是記錄實際請求次數（例如寫進 `job_runs.detail`），要另外設計。

## 修訂紀錄

| 版本 | 日期 | 變更 |
|------|------|------|
| v1 | 2026-11-01 | 初版 |
| v2 | 2026-11-01 | 實作時的調整：(1) 新增 `src/date.ts`（`taipeiDate`、`shiftDate`、`priceFrom`），避免 `portfolioDb.ts` 和 `job.ts` 循環引用；(2) 本機端對端測試發現週末買進的股票沒有前一個收盤價，讀日 K 和回補都改成從第一筆交易往前推 14 天（`PRICE_LOOKBACK_DAYS`），`buildTrend` 也會先走過交易前的 K 棒來帶入價格；(3) 持股摘要由 `job.ts` 自己組（`summarizeHoldings`），共用的讀取放在 `portfolioDb.ts` 的 `loadPortfolio`，不從 `portfolioBot.ts` 匯出，避免循環引用；(4) 每日同步改成 `syncStock(..., backfillFrom)`，沒有任何 K 棒的持股從第一筆交易往前 14 天回補，不是固定 420 天；(5) 持股的歷史日 K 只用 `getEarliestDate` 判斷，`getDateRange` 沒有做 |
