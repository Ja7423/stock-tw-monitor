import type { Bar, StockConfig } from "./types";

export type Trend = "up" | "down" | "sideways";
export type Structure = "higher" | "lower" | "mixed";
export type Alignment = "bullish" | "bearish" | "mixed";

export interface MaStat {
  period: number;
  value: number | null;
  deviationPct: number | null;
  /** 最新一根 K 棒是否站上 / 跌破這條均線 */
  cross: "up" | "down" | null;
}

export interface Analysis {
  date: string;
  close: number;
  dayChangePct: number | null;
  /** 實際使用的 K 棒數（新上市股可能少於設定值） */
  rangeBars: number;
  change: { from: number; to: number; abs: number; pct: number };
  regression: { slopePctPerDay: number; r2: number };
  candles: { red: number; black: number; flat: number };
  structure: Structure;
  votes: { up: number; down: number };
  trend: Trend;
  mas: MaStat[];
  alignment: Alignment | null;
  percentile: { bars: number; value: number };
  week52: { bars: number; high: number; low: number; fromHighPct: number; fromLowPct: number };
}

export const WEEK52_BARS = 250;

/** 以 endIndex 為最後一根計算簡單移動平均；資料不足回傳 null */
export function sma(values: number[], period: number, endIndex = values.length - 1): number | null {
  if (period <= 0 || endIndex < 0 || endIndex + 1 < period) return null;
  let sum = 0;
  for (let i = endIndex - period + 1; i <= endIndex; i++) sum += values[i];
  return sum / period;
}

export function linearRegression(ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = ys.length;
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  ys.forEach((y, x) => {
    sxy += (x - xMean) * (y - yMean);
    sxx += (x - xMean) ** 2;
    syy += (y - yMean) ** 2;
  });
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept: yMean - slope * xMean, r2 };
}

export function countCandles(bars: Bar[]): { red: number; black: number; flat: number } {
  const result = { red: 0, black: 0, flat: 0 };
  for (const b of bars) {
    if (b.close > b.open) result.red++;
    else if (b.close < b.open) result.black++;
    else result.flat++;
  }
  return result;
}

/** 區間切前後兩半，比較兩半的最高點與最低點 */
export function highLowStructure(bars: Bar[]): Structure {
  const half = Math.floor(bars.length / 2);
  if (half < 1) return "mixed";
  const first = bars.slice(0, half);
  const second = bars.slice(bars.length - half);
  const firstHigh = Math.max(...first.map((b) => b.high));
  const secondHigh = Math.max(...second.map((b) => b.high));
  const firstLow = Math.min(...first.map((b) => b.low));
  const secondLow = Math.min(...second.map((b) => b.low));
  if (secondHigh > firstHigh && secondLow > firstLow) return "higher";
  if (secondHigh < firstHigh && secondLow < firstLow) return "lower";
  return "mixed";
}

function maStats(bars: Bar[], periods: number[]): MaStat[] {
  const closes = bars.map((b) => b.close);
  const last = closes.length - 1;
  return periods.map((period) => {
    const value = sma(closes, period);
    if (value === null) return { period, value: null, deviationPct: null, cross: null };
    const prevValue = sma(closes, period, last - 1);
    let cross: MaStat["cross"] = null;
    if (prevValue !== null) {
      const prevClose = closes[last - 1];
      if (prevClose <= prevValue && closes[last] > value) cross = "up";
      else if (prevClose >= prevValue && closes[last] < value) cross = "down";
    }
    return { period, value, deviationPct: ((closes[last] - value) / value) * 100, cross };
  });
}

function maAlignment(mas: MaStat[]): Alignment | null {
  const valid = mas.filter((m) => m.value !== null).sort((a, b) => a.period - b.period);
  if (valid.length < 2) return null;
  const pairs = valid.slice(1).map((m, i) => [valid[i].value!, m.value!] as const);
  if (pairs.every(([short, long]) => short > long)) return "bullish";
  if (pairs.every(([short, long]) => short < long)) return "bearish";
  return "mixed";
}

function rangePosition(bars: Bar[], close: number): number {
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  return high === low ? 50 : ((close - low) / (high - low)) * 100;
}

/** bars 需依日期由舊到新排序 */
export function analyze(bars: Bar[], cfg: StockConfig): Analysis | null {
  if (bars.length < 2) return null;
  const window = bars.slice(-cfg.rangeDays);
  const first = window[0];
  const last = window[window.length - 1];
  const prev = bars[bars.length - 2];

  const from = first.open > 0 ? first.open : first.close;
  const change = { from, to: last.close, abs: last.close - from, pct: ((last.close - from) / from) * 100 };

  const closes = window.map((b) => b.close);
  const reg = linearRegression(closes);
  const meanClose = closes.reduce((a, b) => a + b, 0) / closes.length;
  const regression = { slopePctPerDay: (reg.slope / meanClose) * 100, r2: reg.r2 };

  const candles = countCandles(window);
  const structure = highLowStructure(window);

  const signals = [
    Math.sign(change.pct),
    Math.sign(regression.slopePctPerDay),
    Math.sign(candles.red - candles.black),
    structure === "higher" ? 1 : structure === "lower" ? -1 : 0,
  ];
  const votes = { up: signals.filter((s) => s > 0).length, down: signals.filter((s) => s < 0).length };
  const trend: Trend = votes.up >= 3 ? "up" : votes.down >= 3 ? "down" : "sideways";

  const mas = maStats(bars, cfg.maPeriods);

  const pctBars = bars.slice(-cfg.percentileDays);
  const yearBars = bars.slice(-WEEK52_BARS);
  const yearHigh = Math.max(...yearBars.map((b) => b.high));
  const yearLow = Math.min(...yearBars.map((b) => b.low));

  return {
    date: last.date,
    close: last.close,
    dayChangePct: prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : null,
    rangeBars: window.length,
    change,
    regression,
    candles,
    structure,
    votes,
    trend,
    mas,
    alignment: maAlignment(mas),
    percentile: { bars: pctBars.length, value: rangePosition(pctBars, last.close) },
    week52: {
      bars: yearBars.length,
      high: yearHigh,
      low: yearLow,
      fromHighPct: ((last.close - yearHigh) / yearHigh) * 100,
      fromLowPct: ((last.close - yearLow) / yearLow) * 100,
    },
  };
}
