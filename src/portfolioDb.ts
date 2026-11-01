import { priceFrom } from "./date";
import { getFeeConfig } from "./db";
import type { FeeConfig } from "./fees";
import type { Bar, NewTrade, Trade, TradeType } from "./types";

interface TradeRow {
  id: number;
  stock_id: string;
  type: TradeType;
  trade_date: string;
  shares: number;
  price: number | null;
  amount: number;
  fee: number;
  tax: number;
}

const TRADE_COLUMNS = "id, stock_id, type, trade_date, shares, price, amount, fee, tax";

function toTrade(r: TradeRow): Trade {
  return {
    id: r.id,
    stockId: r.stock_id,
    type: r.type,
    date: r.trade_date,
    shares: r.shares,
    price: r.price,
    amount: r.amount,
    fee: r.fee,
    tax: r.tax,
  };
}

/** 依 (日期, 編號) 排序；不給 stockId 就回傳全部 */
export async function listTrades(db: D1Database, stockId?: string): Promise<Trade[]> {
  const stmt = stockId
    ? db.prepare(`SELECT ${TRADE_COLUMNS} FROM trades WHERE stock_id = ? ORDER BY trade_date, id`).bind(stockId)
    : db.prepare(`SELECT ${TRADE_COLUMNS} FROM trades ORDER BY trade_date, id`);
  const { results } = await stmt.all<TradeRow>();
  return results.map(toTrade);
}

export async function getTrade(db: D1Database, id: number): Promise<Trade | null> {
  const row = await db.prepare(`SELECT ${TRADE_COLUMNS} FROM trades WHERE id = ?`).bind(id).first<TradeRow>();
  return row ? toTrade(row) : null;
}

/** 回傳新交易的編號 */
export async function insertTrade(db: D1Database, t: NewTrade): Promise<number> {
  const res = await db
    .prepare(
      "INSERT INTO trades (stock_id, type, trade_date, shares, price, amount, fee, tax) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(t.stockId, t.type, t.date, t.shares, t.price, t.amount, t.fee, t.tax)
    .run();
  return res.meta.last_row_id;
}

export async function deleteTrade(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM trades WHERE id = ?").bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

export interface HeldStock {
  stockId: string;
  /** 第一筆交易的日期，每日同步沒有任何 K 棒時從這天回補 */
  firstDate: string;
}

/** 目前股數（買進 + 股票股利 − 賣出）大於 0 的股票 */
export async function listHeldStocks(db: D1Database): Promise<HeldStock[]> {
  const { results } = await db
    .prepare(
      `SELECT stock_id, MIN(trade_date) AS first_date FROM trades GROUP BY stock_id
       HAVING SUM(CASE WHEN type = 'sell' THEN -shares ELSE shares END) > 0 ORDER BY stock_id`,
    )
    .all<{ stock_id: string; first_date: string }>();
  return results.map((r) => ({ stockId: r.stock_id, firstDate: r.first_date }));
}

export interface StockInfo {
  name: string;
  market: string | null;
}

/** 先查 stock_info，沒有的話用 watchlist 的名稱 */
export async function getStockInfo(db: D1Database, stockId: string): Promise<StockInfo | null> {
  return db
    .prepare(
      `SELECT name, market FROM stock_info WHERE stock_id = ?1
       UNION ALL SELECT name, market FROM watchlist WHERE stock_id = ?1 LIMIT 1`,
    )
    .bind(stockId)
    .first<StockInfo>();
}

export async function upsertStockInfo(db: D1Database, stockId: string, info: StockInfo): Promise<void> {
  await db
    .prepare(
      `INSERT INTO stock_info (stock_id, name, market) VALUES (?, ?, ?)
       ON CONFLICT(stock_id) DO UPDATE SET name = excluded.name, market = excluded.market`,
    )
    .bind(stockId, info.name, info.market)
    .run();
}

export async function listStockNames(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare("SELECT stock_id, name FROM stock_info").all<{ stock_id: string; name: string }>();
  return new Map(results.map((r) => [r.stock_id, r.name]));
}

/** 多檔股票在 from（含）之後的日K，各自由舊到新 */
export async function getBarsSince(db: D1Database, stockIds: string[], from: string): Promise<Map<string, Bar[]>> {
  const bars = new Map<string, Bar[]>(stockIds.map((id) => [id, []]));
  if (stockIds.length === 0) return bars;
  const { results } = await db
    .prepare(
      `SELECT stock_id, date, open, high, low, close, volume FROM daily_prices
       WHERE date >= ? AND stock_id IN (${stockIds.map(() => "?").join(", ")}) ORDER BY date`,
    )
    .bind(from, ...stockIds)
    .all<Bar & { stock_id: string }>();
  for (const { stock_id, ...bar } of results) bars.get(stock_id)?.push(bar);
  return bars;
}

export interface PortfolioData {
  trades: Trade[];
  /** 從第一筆交易往前 PRICE_LOOKBACK_DAYS 天起的日K */
  bars: Map<string, Bar[]>;
  names: Map<string, string>;
  fee: FeeConfig;
}

/** 計算持股、個股明細和趨勢需要的所有資料；給 stockId 只讀那一檔 */
export async function loadPortfolio(db: D1Database, stockId?: string): Promise<PortfolioData> {
  const trades = await listTrades(db, stockId);
  const ids = [...new Set(trades.map((t) => t.stockId))];
  const from = trades[0] ? priceFrom(trades[0].date) : "";
  const [bars, names, fee] = await Promise.all([getBarsSince(db, ids, from), listStockNames(db), getFeeConfig(db)]);
  return { trades, bars, names, fee };
}
