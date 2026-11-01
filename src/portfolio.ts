import { calcFee, calcTax, type FeeConfig } from "./fees";
import type { Bar, Trade, TradeType } from "./types";

// 持股不存狀態：每次都把交易紀錄依 (日期, 編號) 重新套用一次，補登或刪除後自動更正

/** 尚未寫入的交易用這個編號，排在同一天所有既有交易之後 */
export const PENDING_TRADE_ID = Number.MAX_SAFE_INTEGER;

export interface TradeEntry {
  trade: Trade;
  /** 賣出時該筆的已實現損益（扣手續費、稅與對應成本），其他類型為 null */
  realized: number | null;
}

export interface PositionState {
  shares: number;
  /** 持有成本，含買進手續費 */
  cost: number;
  /** 累計價差損益 */
  realizedTrading: number;
  /** 累計現金股利 */
  realizedDividend: number;
  entries: TradeEntry[];
}

export const EMPTY_POSITION: PositionState = { shares: 0, cost: 0, realizedTrading: 0, realizedDividend: 0, entries: [] };

export type ReplayResult = { ok: true; position: PositionState } | { ok: false; negativeOn: string };

const tradeAmount = (t: Trade) => (t.price ?? 0) * t.shares;

type Reducer = (p: PositionState, t: Trade) => PositionState;

function sell(p: PositionState, t: Trade): PositionState {
  // 移動加權平均：賣出的成本按股數比例扣除，均價不變
  const costOut = p.shares > 0 ? (p.cost * t.shares) / p.shares : 0;
  const realized = tradeAmount(t) - t.fee - t.tax - costOut;
  const shares = p.shares - t.shares;
  return {
    ...p,
    shares,
    cost: shares === 0 ? 0 : p.cost - costOut,
    realizedTrading: p.realizedTrading + realized,
    entries: [...p.entries, { trade: t, realized }],
  };
}

// 新增交易類型（例如減資）時只要在這裡加一個 reducer
const REDUCERS: Record<TradeType, Reducer> = {
  buy: (p, t) => ({
    ...p,
    shares: p.shares + t.shares,
    cost: p.cost + tradeAmount(t) + t.fee,
    entries: [...p.entries, { trade: t, realized: null }],
  }),
  sell,
  // 股票股利以 0 成本加入，均價因此下降
  stock_dividend: (p, t) => ({ ...p, shares: p.shares + t.shares, entries: [...p.entries, { trade: t, realized: null }] }),
  cash_dividend: (p, t) => ({
    ...p,
    realizedDividend: p.realizedDividend + t.amount,
    entries: [...p.entries, { trade: t, realized: null }],
  }),
};

export function applyTrade(p: PositionState, t: Trade): PositionState {
  return REDUCERS[t.type](p, t);
}

/** 依 (日期, 編號) 排序，同一天依輸入順序；回傳新陣列 */
export function sortTrades(trades: readonly Trade[]): Trade[] {
  return [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

/** trades 需為同一檔股票；任何一天股數變負就回傳那一天 */
export function replayTrades(trades: readonly Trade[]): ReplayResult {
  let position = EMPTY_POSITION;
  for (const t of sortTrades(trades)) {
    position = applyTrade(position, t);
    if (position.shares < 0) return { ok: false, negativeOn: t.date };
  }
  return { ok: true, position };
}

export function avgCost(p: PositionState): number | null {
  return p.shares > 0 ? p.cost / p.shares : null;
}

export interface PositionValue {
  close: number;
  closeDate: string;
  marketValue: number;
  /** 市值扣掉預估賣出手續費與證交稅 */
  netValue: number;
  unrealized: number;
  unrealizedPct: number | null;
}

export function valuePosition(stockId: string, p: PositionState, bar: Bar, fee: FeeConfig): PositionValue {
  const marketValue = bar.close * p.shares;
  const sellCosts = p.shares > 0 ? calcFee(marketValue, p.shares, fee) + calcTax(stockId, marketValue) : 0;
  const netValue = marketValue - sellCosts;
  const unrealized = netValue - p.cost;
  return {
    close: bar.close,
    closeDate: bar.date,
    marketValue,
    netValue,
    unrealized,
    unrealizedPct: p.cost > 0 ? (unrealized / p.cost) * 100 : null,
  };
}

export interface Holding {
  stockId: string;
  position: PositionState;
  /** 沒有任何 K 棒或已出清時為 null */
  value: PositionValue | null;
}

export interface PortfolioTotals {
  cost: number;
  marketValue: number;
  netValue: number;
  unrealized: number;
  unrealizedPct: number | null;
  realizedTrading: number;
  realizedDividend: number;
  /** 有持股但沒有價格、沒算進市值的檔數 */
  unpriced: number;
}

/** 市值相關的加總只算有持股且有價格的股票；已實現損益包含已出清的股票 */
export function summarizePortfolio(holdings: readonly Holding[]): PortfolioTotals {
  const totals: PortfolioTotals = {
    cost: 0,
    marketValue: 0,
    netValue: 0,
    unrealized: 0,
    unrealizedPct: null,
    realizedTrading: 0,
    realizedDividend: 0,
    unpriced: 0,
  };
  for (const { position, value } of holdings) {
    totals.realizedTrading += position.realizedTrading;
    totals.realizedDividend += position.realizedDividend;
    if (position.shares === 0) continue;
    if (!value) {
      totals.unpriced += 1;
      continue;
    }
    totals.cost += position.cost;
    totals.marketValue += value.marketValue;
    totals.netValue += value.netValue;
    totals.unrealized += value.unrealized;
  }
  totals.unrealizedPct = totals.cost > 0 ? (totals.unrealized / totals.cost) * 100 : null;
  return totals;
}

export function groupByStock(trades: readonly Trade[]): Map<string, Trade[]> {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) groups.set(t.stockId, [...(groups.get(t.stockId) ?? []), t]);
  return groups;
}

function toHolding(stockId: string, position: PositionState, bar: Bar | undefined, fee: FeeConfig): Holding {
  const value = bar && position.shares > 0 ? valuePosition(stockId, position, bar, fee) : null;
  return { stockId, position, value };
}

/** 每檔股票（含已出清）的持股狀態，用各自最新的 K 棒估值 */
export function buildHoldings(
  trades: readonly Trade[],
  barsByStock: ReadonlyMap<string, readonly Bar[]>,
  fee: FeeConfig,
): Holding[] {
  return [...groupByStock(trades)].map(([stockId, stockTrades]) => {
    const result = replayTrades(stockTrades);
    // 寫入前都檢查過，這裡出現負數代表資料表被直接改過
    if (!result.ok) throw new Error(`${stockId} 在 ${result.negativeOn} 的股數是負數，請檢查交易紀錄`);
    return toHolding(stockId, result.position, barsByStock.get(stockId)?.at(-1), fee);
  });
}

export interface TrendPoint {
  date: string;
  netValue: number;
  unrealized: number;
  unrealizedPct: number | null;
  /** 未實現 + 累計已實現（含股利），不受買賣影響 */
  totalPnl: number;
}

/** 所有股票 K 棒日期的聯集 */
function tradingDays(barsByStock: ReadonlyMap<string, readonly Bar[]>): string[] {
  const days = new Set<string>();
  for (const bars of barsByStock.values()) {
    for (const b of bars) days.add(b.date);
  }
  return [...days].sort();
}

function indexByDate(barsByStock: ReadonlyMap<string, readonly Bar[]>): Map<string, Map<string, Bar>> {
  return new Map([...barsByStock].map(([id, bars]) => [id, new Map(bars.map((b) => [b.date, b]))]));
}

function pointOn(
  date: string,
  positions: ReadonlyMap<string, PositionState>,
  lastBars: ReadonlyMap<string, Bar>,
  fee: FeeConfig,
): TrendPoint {
  const holdings = [...positions].map(([id, p]) => toHolding(id, p, lastBars.get(id), fee));
  const t = summarizePortfolio(holdings);
  return {
    date,
    netValue: t.netValue,
    unrealized: t.unrealized,
    unrealizedPct: t.unrealizedPct,
    totalPnl: t.unrealized + t.realizedTrading + t.realizedDividend,
  };
}

/**
 * 從第一筆交易起每個交易日的收盤估值，回傳最後 days 天。
 * 停牌或交易日沒有 K 棒時沿用之前最後一根，所以第一筆交易之前的 K 棒也會先走過一次。
 */
export function buildTrend(
  trades: readonly Trade[],
  barsByStock: ReadonlyMap<string, readonly Bar[]>,
  days: number,
  fee: FeeConfig,
): TrendPoint[] {
  const sorted = sortTrades(trades);
  if (sorted.length === 0) return [];
  const barsByDate = indexByDate(barsByStock);
  const positions = new Map<string, PositionState>();
  const lastBars = new Map<string, Bar>();
  const points: TrendPoint[] = [];
  let next = 0;
  const firstDate = sorted[0].date;
  for (const date of tradingDays(barsByStock)) {
    for (; next < sorted.length && sorted[next].date <= date; next++) {
      const t = sorted[next];
      positions.set(t.stockId, applyTrade(positions.get(t.stockId) ?? EMPTY_POSITION, t));
    }
    for (const [id, byDate] of barsByDate) {
      const bar = byDate.get(date);
      if (bar) lastBars.set(id, bar);
    }
    if (date >= firstDate) points.push(pointOn(date, positions, lastBars, fee));
  }
  return points.slice(-days);
}

/** 最後一個交易日的損益：總損益和前一個交易日相比，當天投入的資金不算獲利 */
export function dailyPnl(points: readonly TrendPoint[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1].totalPnl - points[points.length - 2].totalPnl;
}
