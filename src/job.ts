import { analyze } from "./analysis";
import { resolveConfig } from "./config";
import {
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
import { formatReport, type StockResult } from "./report";
import { sendMessage } from "./telegram";
import type { Env, WatchItem } from "./types";

// 420 個日曆天約 285 根 K 棒，足夠計算 MA240 與 52 週高低
const BACKFILL_DAYS = 420;
const HISTORY_BARS = 300;
const RETAIN_DAYS = 600;

export function taipeiDate(now: Date): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 增量同步單一股票：已有今天資料就不再呼叫 FinMind */
export async function syncStock(env: Env, stockId: string, today: string): Promise<void> {
  const latest = await getLatestDate(env.DB, stockId);
  if (latest === today) return;
  const bars = await fetchDailyBars(env, stockId, latest ?? shiftDate(today, -BACKFILL_DAYS));
  await upsertBars(env.DB, stockId, bars);
}

interface SyncResult {
  errors: string[];
  quotaExceeded: boolean;
}

/** 額度用完後不再呼叫 FinMind，剩下還沒有今天資料的股票一併列為受影響 */
async function syncAll(env: Env, items: WatchItem[], today: string): Promise<SyncResult> {
  const errors: string[] = [];
  const quotaBlocked: string[] = [];
  for (const item of items) {
    if (quotaBlocked.length > 0) {
      if ((await getLatestDate(env.DB, item.stockId)) !== today) quotaBlocked.push(item.stockId);
      continue;
    }
    try {
      await syncStock(env, item.stockId, today);
    } catch (err) {
      if (err instanceof FinMindQuotaError) quotaBlocked.push(item.stockId);
      else errors.push(`${item.stockId}: ${(err as Error).message}`);
    }
  }
  if (quotaBlocked.length > 0) {
    errors.push(`${quotaBlocked.join("、")}: FinMind 每小時請求額度已用完，下一次排程會自動重試`);
  }
  return { errors, quotaExceeded: quotaBlocked.length > 0 };
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
    const items = await listWatchlist(env.DB);
    if (items.length === 0) {
      if (opts.force) await sendMessage(env, chatId, "監測清單是空的，用 /add 2330 新增股票。");
      return;
    }

    const { errors, quotaExceeded } = await syncAll(env, items, today);
    const global = await getGlobalConfig(env.DB);
    const results: StockResult[] = [];
    for (const item of items) {
      const cfg = resolveConfig(global, item);
      results.push({ item, cfg, analysis: analyze(await getRecentBars(env.DB, item.stockId, HISTORY_BARS), cfg) });
    }

    // 沒有任何一檔有今天的K棒：休市或資料尚未更新，交給下一個 cron 補跑
    if (!opts.force && !results.some((r) => r.analysis?.date === today)) {
      await setJobRun(env.DB, today, "no_data", errors.join("\n") || undefined);
      return;
    }

    for (const message of formatReport(today, global, results, errors)) {
      await sendMessage(env, chatId, message);
    }
    if (!opts.force) {
      // 額度不足的報告不算完成，不記 sent，讓下一次 cron 補抓後重發
      await setJobRun(env.DB, today, quotaExceeded ? "quota_exceeded" : "sent", errors.join("\n") || undefined);
      await pruneBarsBefore(env.DB, shiftDate(today, -RETAIN_DAYS));
    }
  } catch (err) {
    const message = (err as Error).message;
    console.error("runReport failed", err);
    if (!opts.force) await setJobRun(env.DB, today, "error", message);
    await sendMessage(env, chatId, `⚠️ 報告產生失敗：${message}`);
  }
}
