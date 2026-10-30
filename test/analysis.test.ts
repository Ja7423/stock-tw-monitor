import { describe, expect, it } from "vitest";
import { analyze, countCandles, highLowStructure, linearRegression, sma } from "../src/analysis";
import type { Bar } from "../src/types";

/** 由收盤價序列產生K棒：開盤 = 前一日收盤，高低各 ±1 */
function barsFromCloses(closes: number[], startOpen = closes[0]): Bar[] {
  return closes.map((close, i) => {
    const open = i === 0 ? startOpen : closes[i - 1];
    return {
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1000,
    };
  });
}

const cfg = { rangeDays: 10, maPeriods: [5, 10], percentileDays: 20 };

describe("sma", () => {
  it("計算最後 N 根平均", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3, 4, 5], 2)).toBe(4.5);
    expect(sma([1, 2, 3, 4, 5], 2, 2)).toBe(2.5);
  });
  it("資料不足回傳 null", () => {
    expect(sma([1, 2], 5)).toBeNull();
  });
});

describe("linearRegression", () => {
  it("完美直線 R² = 1", () => {
    const r = linearRegression([10, 12, 14, 16]);
    expect(r.slope).toBeCloseTo(2);
    expect(r.intercept).toBeCloseTo(10);
    expect(r.r2).toBeCloseTo(1);
  });
  it("水平線斜率 0", () => {
    expect(linearRegression([5, 5, 5]).slope).toBe(0);
  });
});

describe("countCandles", () => {
  it("分類紅黑平", () => {
    const bars = barsFromCloses([10, 11, 10, 10], 9);
    expect(countCandles(bars)).toEqual({ red: 2, black: 1, flat: 1 });
  });
});

describe("highLowStructure", () => {
  it("上升、下降、震盪", () => {
    expect(highLowStructure(barsFromCloses([10, 11, 12, 13, 14, 15]))).toBe("higher");
    expect(highLowStructure(barsFromCloses([15, 14, 13, 12, 11, 10]))).toBe("lower");
    expect(highLowStructure(barsFromCloses([10, 15, 10, 8, 16, 9]))).toBe("mixed");
  });
});

describe("analyze", () => {
  it("上升趨勢判定為偏多、多頭排列", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const a = analyze(barsFromCloses(closes), cfg)!;
    expect(a.trend).toBe("up");
    expect(a.votes).toEqual({ up: 4, down: 0 });
    expect(a.rangeBars).toBe(10);
    // 區間第一根開盤 = 第 20 根收盤 119，最後收盤 129
    expect(a.change.from).toBe(119);
    expect(a.change.to).toBe(129);
    expect(a.change.pct).toBeCloseTo((10 / 119) * 100);
    expect(a.alignment).toBe("bullish");
    expect(a.mas.every((m) => (m.deviationPct ?? 0) > 0)).toBe(true);
    expect(a.percentile.value).toBeGreaterThan(90);
    expect(a.week52.bars).toBe(30);
  });

  it("下降趨勢判定為偏空", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 200 - i);
    const a = analyze(barsFromCloses(closes), cfg)!;
    expect(a.trend).toBe("down");
    expect(a.alignment).toBe("bearish");
  });

  it("偵測站上均線", () => {
    // 前 9 根在 100，昨天跌到 95，今天拉到 110
    const closes = [...Array(9).fill(100), 95, 110];
    const a = analyze(barsFromCloses(closes), { ...cfg, maPeriods: [5] })!;
    expect(a.mas[0].cross).toBe("up");
  });

  it("均線資料不足時為 null", () => {
    const a = analyze(barsFromCloses([10, 11, 12]), { ...cfg, maPeriods: [5] })!;
    expect(a.mas[0].value).toBeNull();
    expect(a.alignment).toBeNull();
  });

  it("少於 2 根K棒回傳 null", () => {
    expect(analyze(barsFromCloses([10]), cfg)).toBeNull();
  });
});
