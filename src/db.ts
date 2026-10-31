import { DEFAULT_CONFIG } from "./config";
import type { Bar, StockConfig, WatchItem } from "./types";

const SETTING_KEYS: Record<keyof StockConfig, string> = {
  rangeDays: "range_days",
  maPeriods: "ma_periods",
  percentileDays: "percentile_days",
};

const OVERRIDE_COLUMNS: Record<keyof StockConfig, string> = {
  rangeDays: "range_days",
  maPeriods: "ma_periods",
  percentileDays: "percentile_days",
};

function serialize(key: keyof StockConfig, value: StockConfig[keyof StockConfig]): string {
  return key === "maPeriods" ? JSON.stringify(value) : String(value);
}

export async function getGlobalConfig(db: D1Database): Promise<StockConfig> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  const ma = map.get(SETTING_KEYS.maPeriods);
  return {
    rangeDays: Number(map.get(SETTING_KEYS.rangeDays) ?? DEFAULT_CONFIG.rangeDays),
    maPeriods: ma ? (JSON.parse(ma) as number[]) : DEFAULT_CONFIG.maPeriods,
    percentileDays: Number(map.get(SETTING_KEYS.percentileDays) ?? DEFAULT_CONFIG.percentileDays),
  };
}

export async function setGlobalConfig(db: D1Database, patch: Partial<StockConfig>): Promise<void> {
  const entries = Object.entries(patch) as [keyof StockConfig, StockConfig[keyof StockConfig]][];
  if (entries.length === 0) return;
  await db.batch(
    entries.map(([key, value]) =>
      db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(SETTING_KEYS[key], serialize(key, value)),
    ),
  );
}

interface WatchRow {
  stock_id: string;
  name: string;
  market: string | null;
  range_days: number | null;
  ma_periods: string | null;
  percentile_days: number | null;
}

export async function listWatchlist(db: D1Database): Promise<WatchItem[]> {
  const { results } = await db.prepare("SELECT * FROM watchlist ORDER BY stock_id").all<WatchRow>();
  return results.map((r) => ({
    stockId: r.stock_id,
    name: r.name,
    market: r.market,
    rangeDays: r.range_days,
    maPeriods: r.ma_periods ? (JSON.parse(r.ma_periods) as number[]) : null,
    percentileDays: r.percentile_days,
  }));
}

export async function hasStock(db: D1Database, stockId: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM watchlist WHERE stock_id = ?").bind(stockId).first()) !== null;
}

export async function addStock(db: D1Database, stockId: string, name: string, market: string | null): Promise<void> {
  await db.prepare("INSERT INTO watchlist (stock_id, name, market) VALUES (?, ?, ?)").bind(stockId, name, market).run();
}

/** 回傳是否真的有刪除；同時清掉價格快取 */
export async function removeStock(db: D1Database, stockId: string): Promise<boolean> {
  const [del] = await db.batch([
    db.prepare("DELETE FROM watchlist WHERE stock_id = ?").bind(stockId),
    db.prepare("DELETE FROM daily_prices WHERE stock_id = ?").bind(stockId),
  ]);
  return (del.meta.changes ?? 0) > 0;
}

export async function setOverride(db: D1Database, stockId: string, patch: Partial<StockConfig>): Promise<boolean> {
  const entries = Object.entries(patch) as [keyof StockConfig, StockConfig[keyof StockConfig]][];
  if (entries.length === 0) return false;
  const sets = entries.map(([key]) => `${OVERRIDE_COLUMNS[key]} = ?`).join(", ");
  const res = await db
    .prepare(`UPDATE watchlist SET ${sets} WHERE stock_id = ?`)
    .bind(...entries.map(([key, value]) => serialize(key, value)), stockId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function resetOverride(db: D1Database, stockId: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE watchlist SET range_days = NULL, ma_periods = NULL, percentile_days = NULL WHERE stock_id = ?")
    .bind(stockId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function getLatestDate(db: D1Database, stockId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT MAX(date) AS d FROM daily_prices WHERE stock_id = ?")
    .bind(stockId)
    .first<{ d: string | null }>();
  return row?.d ?? null;
}

export async function upsertBars(db: D1Database, stockId: string, bars: Bar[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO daily_prices (stock_id, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(stock_id, date) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume`,
  );
  for (let i = 0; i < bars.length; i += 100) {
    await db.batch(
      bars.slice(i, i + 100).map((b) => stmt.bind(stockId, b.date, b.open, b.high, b.low, b.close, b.volume)),
    );
  }
}

/** 回傳最近 limit 根 K 棒，由舊到新 */
export async function getRecentBars(db: D1Database, stockId: string, limit: number): Promise<Bar[]> {
  const { results } = await db
    .prepare("SELECT date, open, high, low, close, volume FROM daily_prices WHERE stock_id = ? ORDER BY date DESC LIMIT ?")
    .bind(stockId, limit)
    .all<Bar>();
  return results.reverse();
}

export async function pruneBarsBefore(db: D1Database, date: string): Promise<void> {
  await db.prepare("DELETE FROM daily_prices WHERE date < ?").bind(date).run();
}

export interface JobRun {
  status: string;
  detail: string | null;
  /** UTC，格式 YYYY-MM-DD HH:MM:SS */
  finishedAt: string;
}

export async function getJobRun(db: D1Database, runDate: string): Promise<JobRun | null> {
  return db
    .prepare("SELECT status, detail, finished_at AS finishedAt FROM job_runs WHERE run_date = ?")
    .bind(runDate)
    .first<JobRun>();
}

export async function setJobRun(db: D1Database, runDate: string, status: string, detail?: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO job_runs (run_date, status, detail, finished_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(run_date) DO UPDATE SET status = excluded.status, detail = excluded.detail, finished_at = excluded.finished_at`,
    )
    .bind(runDate, status, detail ?? null)
    .run();
}
