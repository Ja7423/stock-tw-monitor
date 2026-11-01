import { analyze } from "./analysis";
import { resolveConfig } from "./config";
import { priceFrom, shiftDate, taipeiDate } from "./date";
import {
  getEarliestDate,
  getGlobalConfig,
  getJobRun,
  getLatestDate,
  getRecentBars,
  listWatchlist,
  pruneBarsBefore,
  setJobRun,
  upsertBars,
} from "./db";
import { FinMindQuotaError, fetchDailyBars } from "./finmind";
import { buildHoldings, buildTrend, summarizePortfolio } from "./portfolio";
import { listHeldStocks, loadPortfolio, type HeldStock } from "./portfolioDb";
import { formatDailySummary, withNames } from "./portfolioReport";
import { formatReport, formatSyncErrors, type StockResult } from "./report";
import type { SyncLoad } from "./status";
import { sendMessage } from "./telegram";
import type { Env, StockConfig, WatchItem } from "./types";

// 420 個日曆天約 285 根 K 棒，足夠計算 MA240 與 52 週高低
const BACKFILL_DAYS = 420;
const HISTORY_BARS = 300;
const RETAIN_DAYS = 600;

/** 監測股票要回補到哪一天才夠算長天期均線 */
export function watchBackfillFrom(today: string): string {
  return shiftDate(today, -BACKFILL_DAYS);
}

/** 增量同步單一股票：已有今天資料就不再呼叫 FinMind；完全沒有資料時從 backfillFrom 回補 */
export async function syncStock(env: Env, stockId: string, today: string, backfillFrom = watchBackfillFrom(today)): Promise<void> {
  const latest = await getLatestDate(env.DB, stockId);
  if (latest === today) return;
  const bars = await fetchDailyBars(env, stockId, latest ?? backfillFrom);
  await upsertBars(env.DB, stockId, bars);
}

/** 確保日K涵蓋 from 到今天：最早的 K 棒晚於 from 時從 from 重抓，否則只增量同步 */
export async function ensureHistory(env: Env, stockId: string, from: string, today: string): Promise<void> {
  const earliest = await getEarliestDate(env.DB, stockId);
  if (earliest !== null && earliest <= from) return syncStock(env, stockId, today);
  await upsertBars(env.DB, stockId, await fetchDailyBars(env, stockId, from));
}

export interface SyncTarget {
  stockId: string;
  /** 完全沒有 K 棒時從這天回補；持股是第一筆交易往前推 PRICE_LOOKBACK_DAYS 天 */
  backfillFrom: string;
}

/** 監測清單 ∪ 目前持股，同一檔只同步一次；兩邊都有時取較早的回補日 */
export function syncTargets(watchIds: string[], held: HeldStock[], today: string): SyncTarget[] {
  const targets = new Map<string, string>(watchIds.map((id) => [id, watchBackfillFrom(today)]));
  for (const { stockId, firstDate } of held) {
    const from = priceFrom(firstDate);
    const current = targets.get(stockId);
    targets.set(stockId, current && current < from ? current : from);
  }
  return [...targets].map(([stockId, backfillFrom]) => ({ stockId, backfillFrom }));
}

export async function getSyncLoad(db: D1Database, today: string): Promise<SyncLoad> {
  const [items, held] = await Promise.all([listWatchlist(db), listHeldStocks(db)]);
  const watchIds = items.map((i) => i.stockId);
  return { watch: watchIds.length, held: held.length, total: syncTargets(watchIds, held, today).length };
}

interface SyncResult {
  errors: string[];
  quotaExceeded: boolean;
}

/** 額度用完後不再呼叫 FinMind，剩下還沒有今天資料的股票一併列為受影響 */
async function syncAll(env: Env, targets: SyncTarget[], today: string): Promise<SyncResult> {
  const errors: string[] = [];
  const quotaBlocked: string[] = [];
  for (const { stockId, backfillFrom } of targets) {
    if (quotaBlocked.length > 0) {
      if ((await getLatestDate(env.DB, stockId)) !== today) quotaBlocked.push(stockId);
      continue;
    }
    try {
      await syncStock(env, stockId, today, backfillFrom);
    } catch (err) {
      if (err instanceof FinMindQuotaError) quotaBlocked.push(stockId);
      else errors.push(`${stockId}: ${(err as Error).message}`);
    }
  }
  if (quotaBlocked.length > 0) {
    errors.push(`${quotaBlocked.join("、")}: FinMind 每小時請求額度已用完，下一次排程會自動重試`);
  }
  return { errors, quotaExceeded: quotaBlocked.length > 0 };
}

async function analyzeWatchlist(env: Env, items: WatchItem[], global: StockConfig): Promise<StockResult[]> {
  const results: StockResult[] = [];
  for (const item of items) {
    const cfg = resolveConfig(global, item);
    results.push({ item, cfg, analysis: analyze(await getRecentBars(env.DB, item.stockId, HISTORY_BARS), cfg) });
  }
  return results;
}

interface HoldingsSummary {
  messages: string[];
  /** 持股最新 K 棒的日期，用來判斷今天是否有資料 */
  latestDate: string | null;
}

const EMPTY_SUMMARY: HoldingsSummary = { messages: [], latestDate: null };

async function summarizeHoldings(env: Env, held: HeldStock[], today: string): Promise<HoldingsSummary> {
  if (held.length === 0) return EMPTY_SUMMARY;
  const data = await loadPortfolio(env.DB);
  const holdings = buildHoldings(data.trades, data.bars, data.fee);
  const points = buildTrend(data.trades, data.bars, 2, data.fee);
  const rows = withNames(holdings, data.names);
  return {
    messages: formatDailySummary(rows, summarizePortfolio(holdings), points, today),
    latestDate: points.at(-1)?.date ?? null,
  };
}

/** 監測或持股任何一檔有今天的K棒；都沒有代表休市或資料尚未更新 */
function hasTodayData(results: StockResult[], holdings: HoldingsSummary, today: string): boolean {
  return results.some((r) => r.analysis?.date === today) || holdings.latestDate === today;
}

/** 額度不足的報告不算完成，不記 sent，讓下一次 cron 補抓後重發 */
async function finishRun(env: Env, today: string, quotaExceeded: boolean, detail: string | undefined): Promise<void> {
  await setJobRun(env.DB, today, quotaExceeded ? "quota_exceeded" : "sent", detail);
  await pruneBarsBefore(env.DB, shiftDate(today, -RETAIN_DAYS));
}

/** 監測清單是空的時不發報告本體，但仍要讓使用者看到同步失敗的股票 */
function reportMessages(today: string, global: StockConfig, results: StockResult[], errors: string[]): string[] {
  if (results.length > 0) return formatReport(today, global, results, errors);
  return errors.length > 0 ? [formatSyncErrors(errors)] : [];
}

export interface RunOptions {
  /** 手動 /report：略過重複推播與無當日資料的檢查 */
  force?: boolean;
  chatId?: string | number;
}

export async function runReport(env: Env, now: Date, opts: RunOptions = {}): Promise<void> {
  const today = taipeiDate(now);
  const chatId = opts.chatId ?? env.ALLOWED_CHAT_ID;

  if (!opts.force && (await getJobRun(env.DB, today))?.status === "sent") return;

  try {
    const [items, held] = await Promise.all([listWatchlist(env.DB), listHeldStocks(env.DB)]);
    if (items.length === 0 && held.length === 0) {
      if (opts.force) await sendMessage(env, chatId, "監測清單和持股都是空的，用 /add 2330 新增監測或 /buy 記錄買進。");
      return;
    }

    const targets = syncTargets(items.map((i) => i.stockId), held, today);
    const { errors, quotaExceeded } = await syncAll(env, targets, today);
    const global = await getGlobalConfig(env.DB);
    const results = await analyzeWatchlist(env, items, global);
    const holdings = await summarizeHoldings(env, held, today);
    const detail = errors.join("\n") || undefined;

    // 交給下一個 cron 補跑
    if (!opts.force && !hasTodayData(results, holdings, today)) {
      await setJobRun(env.DB, today, "no_data", detail);
      return;
    }

    for (const message of [...reportMessages(today, global, results, errors), ...holdings.messages]) {
      await sendMessage(env, chatId, message);
    }
    if (!opts.force) await finishRun(env, today, quotaExceeded, detail);
  } catch (err) {
    const message = (err as Error).message;
    console.error("runReport failed", err);
    if (!opts.force) await setJobRun(env.DB, today, "error", message);
    await sendMessage(env, chatId, `⚠️ 報告產生失敗：${message}`);
  }
}
