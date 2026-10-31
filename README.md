# 台股 K 棒監測 (tw-stock-monitor)

每個交易日收盤後，分析監測清單中每檔股票近期的 K 棒走勢，並用 Telegram Bot 推播報告。
監測清單和參數都用 Telegram 指令管理。

- 執行環境：Cloudflare Workers（Cron Triggers 和 Telegram webhook）
- 資料庫：Cloudflare D1
- 股價來源：[FinMind](https://finmindtrade.com/) `TaiwanStockPrice`

## 架構

```
Telegram ──webhook──► Worker fetch()     ──► D1 (watchlist / settings / daily_prices / job_runs)
                      Worker scheduled() ──► FinMind（增量抓日K）──► 分析 ──► Telegram sendMessage
```

- Cron 時間為 UTC 07:00 和 08:00，也就是台北 15:00 和 16:00，只在週一到週五執行。15:00 那次如果沒有任何一檔有當天的 K 棒，就當成休市或資料還沒更新，不發報告，16:00 再補跑一次。`job_runs` 確保同一天只推播一次。
- 新增股票時，一次回補 420 個日曆天（約 285 根 K 棒）。之後每天只抓新增的資料。

## 分析指標

| 指標 | 說明 |
|---|---|
| 首尾漲跌 | 區間第一根的開盤價到最後一根的收盤價 |
| 迴歸斜率 | 收盤價線性迴歸的斜率，換算成每日 %，附 R² |
| 紅黑 K | 區間內紅 K、黑 K、平盤各幾根 |
| 高低點結構 | 區間前後兩半的最高點和最低點比較 |
| 綜合判定 | 以上四項投票，3 票以上同方向判定為偏多或偏空，否則為盤整 |
| 均線位階 | 現價和各 MA 的乖離 %、多頭或空頭排列、當日站上或跌破均線 |
| 區間百分位 | 現價在近 N 日最高到最低之間的位置 |
| 52 週高低 | 距近 250 根 K 棒最高點和最低點的 % |

> 注意：股價是**未還原**價格，除權息造成的跳空會影響長天期均線。

## Telegram 指令

```
/add 2330 2317                    新增監測（一次最多 10 檔）
/del 2330                         刪除
/list                             清單
/report                           立即產生報告
/explain                          報告欄位說明
/settings                         全域設定
/set range 20                     全域觀察區間
/set ma 5,10,20,60,120,240        全域均線
/set pct 120                      全域百分位區間
/override 2330 range=20 ma=5,20   個股覆寫
/reset 2330                       清除個股覆寫
```

預設參數：區間 10 日，MA 5/10/20/60/120/240，百分位 120 日。

## 部署

需要準備：Cloudflare 帳號、Telegram Bot Token（向 @BotFather 申請）、你的 chat_id（傳訊息給 @userinfobot 取得）、FinMind API Token。

```bash
npm install
npx wrangler login

# 1. 建立 D1，把輸出的 database_id 填進 wrangler.toml
npx wrangler d1 create stock-tw-monitor

# 2. 建立資料表
npm run db:migrate

# 3. 設定密鑰（逐一輸入）
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # 自己產生的隨機字串，例如 openssl rand -hex 32
npx wrangler secret put ALLOWED_CHAT_ID
npx wrangler secret put FINMIND_TOKEN

# 4. 部署
npm run deploy

# 5. 設定 webhook 和指令選單
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy ./scripts/set-webhook.sh https://tw-stock-monitor.<你的子網域>.workers.dev
```

### GitHub 自動部署（選配）

`.github/workflows/deploy.yml` 會在 push 到 `master` 時執行測試、migration 和部署。
要先在 repo 的 Secrets 設定 `CLOUDFLARE_API_TOKEN`（權限選 Workers Scripts:Edit 和 D1:Edit，不需要 zone 權限）以及 `CLOUDFLARE_ACCOUNT_ID`。

## 本機開發

```bash
cp .dev.vars.example .dev.vars   # 填入實際的值
npm run db:migrate:local
npm run dev
# 另開終端機觸發排程：
curl "http://localhost:8787/__scheduled?cron=0+7+*+*+1-5"
```

```bash
npm test          # 單元測試
npm run typecheck
```

## 限制

- Workers 免費方案單次執行約可發 50 個對外請求，每日報告每檔股票約用 1 個，**清單建議在 40 檔以內**。超過的話可以升級付費方案，或改用 Cloudflare Workflows 分批處理。
- FinMind 免費帳號每小時 600 次請求，個人使用綽綽有餘。
