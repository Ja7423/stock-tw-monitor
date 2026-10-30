import { describe, expect, it } from "vitest";
import { analyze } from "../src/analysis";
import { formatReport } from "../src/report";
import type { Bar } from "../src/types";

const bars: Bar[] = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-10-${String(i + 1).padStart(2, "0")}`,
  open: 100 + i - 0.5,
  high: 101 + i,
  low: 99 + i,
  close: 100 + i,
  volume: 1000,
}));
const cfg = { rangeDays: 10, maPeriods: [5, 20], percentileDays: 20 };
const item = { stockId: "2330", name: "台積電", market: "twse", rangeDays: null, maPeriods: null, percentileDays: null };

describe("formatReport", () => {
  it("包含標頭與個股內容", () => {
    const [msg] = formatReport("2026-10-30", cfg, [{ item, cfg, analysis: analyze(bars, cfg) }]);
    expect(msg).toContain("📊 台股監測 2026-10-30");
    expect(msg).toContain("2330 台積電");
    expect(msg).toContain("⬆️ 偏多");
    expect(msg).toContain("10紅0黑0平");
    expect(msg).toContain("多頭排列");
    expect(msg).toContain("(僅30日)");
  });

  it("超過長度會分成多則", () => {
    const results = Array.from({ length: 40 }, () => ({ item, cfg, analysis: analyze(bars, cfg) }));
    const messages = formatReport("2026-10-30", cfg, results);
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((m) => m.length <= 4000)).toBe(true);
  });

  it("資料不足與錯誤訊息", () => {
    const [msg] = formatReport("2026-10-30", cfg, [{ item, cfg, analysis: null }], ["2317: timeout"]);
    expect(msg).toContain("資料不足");
    expect(msg).toContain("2317: timeout");
  });
});
