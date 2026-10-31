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

export function formatStatus(today: string, run: JobRun | null, quota: FinMindQuota | Error): string {
  return [`🩺 系統狀態 ${today}`, ...formatJobRun(run), formatQuota(quota)].join("\n");
}
