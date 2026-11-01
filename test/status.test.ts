import { describe, expect, it } from "vitest";
import { estimateRunRequests, formatStatus, syncLoadWarning } from "../src/status";

const quota = { used: 12, limit: 600 };
const load = { watch: 2, held: 1, total: 3 };

describe("formatStatus", () => {
  it("今天還沒執行", () => {
    const msg = formatStatus("2026-10-31", null, quota, load);
    expect(msg).toContain("🩺 系統狀態 2026-10-31");
    expect(msg).toContain("今日排程：尚未執行");
    expect(msg).toContain("FinMind 額度：12 / 600（本小時）");
  });

  it("已推播，執行時間轉成台北時間", () => {
    const msg = formatStatus("2026-10-31", { status: "sent", detail: null, finishedAt: "2026-10-31 07:00:12" }, quota, load);
    expect(msg).toContain("今日排程：✅ 已推播");
    expect(msg).toContain("執行時間：15:00");
    expect(msg).not.toContain("錯誤內容");
  });

  it("額度用完時列出錯誤內容與警示", () => {
    const run = {
      status: "quota_exceeded",
      detail: "5274: FinMind 每小時請求額度已用完，下一次排程會自動重試",
      finishedAt: "2026-10-31 07:00:30",
    };
    const msg = formatStatus("2026-10-31", run, { used: 600, limit: 600 }, load);
    expect(msg).toContain("⚠️ FinMind 額度用完");
    expect(msg).toContain("  5274: FinMind 每小時請求額度已用完");
    expect(msg).toContain("600 / 600（本小時）  ⚠️ 已用完");
  });

  it("未知狀態直接顯示原值", () => {
    const msg = formatStatus("2026-10-31", { status: "weird", detail: null, finishedAt: "2026-10-31 07:00:00" }, quota, load);
    expect(msg).toContain("今日排程：weird");
  });

  it("額度查詢失敗不影響其他內容", () => {
    const msg = formatStatus("2026-10-31", null, new Error("FinMind HTTP 500: boom"), load);
    expect(msg).toContain("今日排程：尚未執行");
    expect(msg).toContain("FinMind 額度：查詢失敗（FinMind HTTP 500: boom）");
  });

  it("過長的錯誤內容會截斷", () => {
    const run = { status: "error", detail: "x".repeat(3000), finishedAt: "2026-10-31 07:00:00" };
    expect(formatStatus("2026-10-31", run, quota, load).length).toBeLessThan(1700);
  });

  it("列出每日同步檔數與請求估計", () => {
    expect(formatStatus("2026-10-31", null, quota, load)).toContain("每日同步：3 檔（監測 2、持股 1）｜每次排程約 5 / 50 個對外請求");
  });
});

describe("estimateRunRequests", () => {
  it("每檔 1 次 FinMind，加上報告和持股摘要的訊息數", () => {
    expect(estimateRunRequests({ watch: 0, held: 0, total: 0 })).toBe(0);
    expect(estimateRunRequests({ watch: 2, held: 1, total: 3 })).toBe(5);
    expect(estimateRunRequests({ watch: 25, held: 10, total: 30 })).toBe(34);
  });
});

describe("syncLoadWarning", () => {
  it("超過 40 檔才警告", () => {
    expect(syncLoadWarning({ watch: 30, held: 10, total: 40 })).toBeNull();
    expect(syncLoadWarning({ watch: 30, held: 11, total: 41 })).toContain("合計 41 檔");
  });
});
