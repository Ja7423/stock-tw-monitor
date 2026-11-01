import { SUBREQUEST_LIMIT, SYNC_WARN_STOCKS } from "./config";
import type { JobRun } from "./db";
import type { FinMindQuota } from "./finmind";

// 錯誤內容可能很長（每檔一行），留空間給其他欄位，避免超過 Telegram 4096 字上限
const DETAIL_LIMIT = 1500;

const STATUS_LABEL: Record<string, string> = {
  sent: "✅ 已推播",
  no_data: "⏸ 沒有當天資料（休市或 FinMind 尚未更新），等下一次排程",
  quota_exceeded: "⚠️ FinMind 額度用完，已先發部分報告，等下一次排程補跑",
  error: "❌ 報告產生失敗",
};

/** D1 datetime('now') 是 UTC，轉成台北時間 HH:MM */
function taipeiTime(utc: string): string {
  const d = new Date(`${utc.replace(" ", "T")}Z`);
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(11, 16);
}

function formatJobRun(run: JobRun | null): string[] {
  if (!run) return ["今日排程：尚未執行（週一至週五 15:00，16:00 補跑）"];
  const lines = [`今日排程：${STATUS_LABEL[run.status] ?? run.status}`, `執行時間：${taipeiTime(run.finishedAt)}`];
  if (run.detail) {
    const detail = run.detail.length > DETAIL_LIMIT ? `${run.detail.slice(0, DETAIL_LIMIT)}…` : run.detail;
    lines.push(`錯誤內容：\n${detail.split("\n").map((l) => `  ${l}`).join("\n")}`);
  }
  return lines;
}

function formatQuota(quota: FinMindQuota | Error): string {
  if (quota instanceof Error) return `FinMind 額度：查詢失敗（${quota.message}）`;
  const warning = quota.used >= quota.limit ? "  ⚠️ 已用完" : "";
  return `FinMind 額度：${quota.used} / ${quota.limit}（本小時）${warning}`;
}

export interface SyncLoad {
  /** 監測清單檔數 */
  watch: number;
  /** 目前持股檔數 */
  held: number;
  /** 兩者去重後，每日排程要同步的檔數 */
  total: number;
}

// 每則報告大約放得下的股票數，用來估計 Telegram 訊息數
const STOCKS_PER_REPORT_MESSAGE = 10;
const STOCKS_PER_SUMMARY_MESSAGE = 40;

/** 每次排程的對外請求估計：每檔 1 次 FinMind，加上報告與持股摘要的訊息數 */
export function estimateRunRequests(load: SyncLoad): number {
  return (
    load.total +
    Math.ceil(load.watch / STOCKS_PER_REPORT_MESSAGE) +
    Math.ceil(load.held / STOCKS_PER_SUMMARY_MESSAGE)
  );
}

export function formatSyncLoad(load: SyncLoad): string {
  return (
    `每日同步：${load.total} 檔（監測 ${load.watch}、持股 ${load.held}）｜` +
    `每次排程約 ${estimateRunRequests(load)} / ${SUBREQUEST_LIMIT} 個對外請求`
  );
}

/** 超過門檻時附在 /add、/buy 回覆的警告；不阻擋 */
export function syncLoadWarning(load: SyncLoad): string | null {
  if (load.total <= SYNC_WARN_STOCKS) return null;
  return (
    `⚠️ 監測與持股合計 ${load.total} 檔，超過 ${SYNC_WARN_STOCKS} 檔，` +
    `每日排程可能超過 Cloudflare 每次執行約 ${SUBREQUEST_LIMIT} 個對外請求的上限`
  );
}

export function formatStatus(today: string, run: JobRun | null, quota: FinMindQuota | Error, load: SyncLoad): string {
  return [`🩺 系統狀態 ${today}`, ...formatJobRun(run), formatQuota(quota), formatSyncLoad(load)].join("\n");
}
