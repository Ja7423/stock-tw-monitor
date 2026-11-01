import { fmtMoney, fmtPct, fmtPrice, fmtSignedMoney } from "./format";
import { splitMessages } from "./message";
import {
  avgCost,
  dailyPnl,
  type Holding,
  type PortfolioTotals,
  type PositionState,
  type PositionValue,
  type TradeEntry,
  type TrendPoint,
} from "./portfolio";
import type { TradeType } from "./types";

export interface HoldingRow extends Holding {
  name: string;
}

export const TREND_STEP = 5;

export function withNames(holdings: readonly Holding[], names: ReadonlyMap<string, string>): HoldingRow[] {
  return holdings.map((h) => ({ ...h, name: names.get(h.stockId) ?? "" }));
}

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

const fmtShares = (n: number) => `${fmtMoney(n)} 股`;
const fmtUnrealized = (amount: number, pct: number | null) => `${fmtSignedMoney(amount)}${pct === null ? "" : ` (${fmtPct(pct)})`}`;
const staleNote = (value: PositionValue, today: string) => (value.closeDate === today ? "" : ` [資料日 ${value.closeDate}]`);

const TRADE_DETAIL: Record<TradeType, (e: TradeEntry) => string> = {
  buy: ({ trade: t }) => `買 ${fmtShares(t.shares)} @ ${fmtPrice(t.price ?? 0)}｜費 ${fmtMoney(t.fee)}`,
  sell: ({ trade: t, realized }) =>
    `賣 ${fmtShares(t.shares)} @ ${fmtPrice(t.price ?? 0)}｜費 ${fmtMoney(t.fee)} 稅 ${fmtMoney(t.tax)}｜損益 ${fmtSignedMoney(realized ?? 0)}`,
  cash_dividend: ({ trade: t }) => `現金股利 ${fmtMoney(t.amount)}`,
  stock_dividend: ({ trade: t }) => `股票股利 ${fmtShares(t.shares)}`,
};

export function formatTradeLine(entry: TradeEntry): string {
  return `#${entry.trade.id} ${entry.trade.date} ${TRADE_DETAIL[entry.trade.type](entry)}`;
}

/** 持有 1,500 股｜均價 586.23 */
export function formatPositionLine(p: PositionState): string {
  const avg = avgCost(p);
  return avg === null ? "已出清" : `持有 ${fmtShares(p.shares)}｜均價 ${fmtPrice(avg)}`;
}

function formatRealized(realizedTrading: number, realizedDividend: number): string {
  return `${fmtSignedMoney(realizedTrading + realizedDividend)}（價差 ${fmtSignedMoney(realizedTrading)}｜股利 ${fmtSignedMoney(realizedDividend)}）`;
}

function formatHoldingBlock(row: HoldingRow, today: string): string {
  const { position: p, value } = row;
  const title = `${row.stockId} ${row.name}  ${fmtShares(p.shares)}`;
  const avg = `均價 ${fmtPrice(avgCost(p) ?? 0)}`;
  if (!value) return `${title}\n  ${avg}｜⚠️ 尚無價格資料`;
  return (
    `${title}${staleNote(value, today)}\n` +
    `  ${avg}｜現價 ${fmtPrice(value.close)}｜淨值 ${fmtMoney(value.netValue)}\n` +
    `  未實現 ${fmtUnrealized(value.unrealized, value.unrealizedPct)}`
  );
}

function formatTotals(t: PortfolioTotals, extraLines: string[]): string {
  const lines = [
    `總成本 ${fmtMoney(t.cost)}｜總市值 ${fmtMoney(t.marketValue)}｜總淨值 ${fmtMoney(t.netValue)}`,
    `未實現 ${fmtUnrealized(t.unrealized, t.unrealizedPct)}`,
    ...extraLines,
    `累計已實現 ${formatRealized(t.realizedTrading, t.realizedDividend)}`,
  ];
  if (t.unpriced > 0) lines.push(`⚠️ ${t.unpriced} 檔尚無價格，未計入市值與淨值`);
  return lines.join("\n");
}

/** 只列有持股的股票，依淨值從大到小；沒有價格的排最後 */
function holdingBlocks(rows: HoldingRow[], today: string): string[] {
  return rows
    .filter((r) => r.position.shares > 0)
    .sort((a, b) => (b.value?.netValue ?? -Infinity) - (a.value?.netValue ?? -Infinity))
    .map((r) => formatHoldingBlock(r, today));
}

const NO_HOLDINGS = "目前沒有持股，用 /buy 2330 1000 580 記錄買進。";

/** /holdings：持股清單與淨值加總 */
export function formatHoldings(rows: HoldingRow[], totals: PortfolioTotals, today: string): string[] {
  const blocks = holdingBlocks(rows, today);
  if (blocks.length === 0) {
    const hasRealized = totals.realizedTrading !== 0 || totals.realizedDividend !== 0;
    return [hasRealized ? `${NO_HOLDINGS}\n累計已實現 ${formatRealized(totals.realizedTrading, totals.realizedDividend)}` : NO_HOLDINGS];
  }
  return splitMessages([`💼 持股（${blocks.length} 檔）`, ...blocks, formatTotals(totals, [])]);
}

/** 最後一個交易日不是今天時，標出是哪一天的損益 */
function formatDailyPnl(points: readonly TrendPoint[], today: string): string[] {
  const pnl = dailyPnl(points);
  if (pnl === null) return [];
  const last = points[points.length - 1].date;
  return [`${last === today ? "今日" : `${last} `}損益 ${fmtSignedMoney(pnl)}`];
}

/** 每日推播的持股摘要：和 /holdings 相同，多一行今日損益 */
export function formatDailySummary(
  rows: HoldingRow[],
  totals: PortfolioTotals,
  points: readonly TrendPoint[],
  today: string,
): string[] {
  const blocks = holdingBlocks(rows, today);
  if (blocks.length === 0) return [];
  return splitMessages([`💼 持股摘要 ${today}（${blocks.length} 檔）`, ...blocks, formatTotals(totals, formatDailyPnl(points, today))]);
}

/** /pos：個股摘要與全部交易紀錄，太長時拆成多則 */
export function formatPosition(row: HoldingRow, today: string): string[] {
  const { position: p, value } = row;
  const summary = [`📄 ${row.stockId} ${row.name}`, formatPositionLine(p)];
  if (p.shares > 0) summary[1] += `｜成本 ${fmtMoney(p.cost)}`;
  if (value) {
    summary.push(
      `現價 ${fmtPrice(value.close)}${staleNote(value, today)}｜淨值 ${fmtMoney(value.netValue)}｜` +
        `未實現 ${fmtUnrealized(value.unrealized, value.unrealizedPct)}`,
    );
  } else if (p.shares > 0) {
    summary.push("⚠️ 尚無價格資料");
  }
  summary.push(`已實現 ${formatRealized(p.realizedTrading, p.realizedDividend)}`, "", "交易紀錄");
  return splitMessages([summary.join("\n"), ...p.entries.map(formatTradeLine)], "\n");
}

export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  const top = SPARK_CHARS.length - 1;
  return values.map((v) => SPARK_CHARS[span === 0 ? Math.floor(top / 2) : Math.round(((v - min) / span) * top)]).join("");
}

/** 從最後一天往前每 step 天取一點，讓最新的一天一定出現 */
function samplePoints(points: readonly TrendPoint[], step: number): TrendPoint[] {
  const sampled: TrendPoint[] = [];
  for (let i = points.length - 1; i >= 0; i -= step) sampled.unshift(points[i]);
  return sampled;
}

const fmtTrendPct = (pct: number | null) => (pct === null ? "—" : fmtPct(pct));

/** /trend：一行未實現報酬率 sparkline，加上每 step 個交易日一列 */
export function formatTrend(title: string, points: readonly TrendPoint[], step = TREND_STEP): string {
  if (points.length === 0) return `${title}\n還沒有可以計算趨勢的價格資料。`;
  const sampled = samplePoints(points, step);
  const rows = sampled.map(
    (p) =>
      `${p.date.slice(5).replace("-", "/")}｜${fmtTrendPct(p.unrealizedPct)}｜` +
      `${fmtSignedMoney(p.unrealized)}｜${fmtSignedMoney(p.totalPnl)}｜${fmtMoney(p.netValue)}`,
  );
  const pcts = sampled.flatMap((p) => (p.unrealizedPct === null ? [] : [p.unrealizedPct]));
  return [
    `📈 ${title} ${points[0].date} ~ ${points[points.length - 1].date}（${points.length} 交易日）`,
    `未實現報酬率 ${sparkline(pcts)}`,
    "",
    "日期｜報酬率｜未實現損益｜總損益｜淨值",
    ...rows,
  ].join("\n");
}
