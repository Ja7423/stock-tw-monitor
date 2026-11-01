import type { Alignment, Analysis, Structure, Trend } from "./analysis";
import { WEEK52_BARS } from "./analysis";
import { fmtPct, fmtPrice, fmtSigned } from "./format";
import { splitMessages } from "./message";
import type { StockConfig, WatchItem } from "./types";

export interface StockResult {
  item: WatchItem;
  cfg: StockConfig;
  analysis: Analysis | null;
}

const TREND_LABEL: Record<Trend, string> = { up: "⬆️ 偏多", down: "⬇️ 偏空", sideways: "↔️ 盤整" };
const STRUCTURE_LABEL: Record<Structure, string> = { higher: "高低點墊高", lower: "高低點下移", mixed: "高低點交錯" };
const ALIGNMENT_LABEL: Record<Alignment, string> = { bullish: "多頭排列", bearish: "空頭排列", mixed: "均線糾結" };

export function formatStock({ item, analysis: a }: StockResult, today: string): string {
  const title = `${item.stockId} ${item.name}`;
  if (!a) return `${title}\n  ⚠️ 資料不足，無法分析`;

  const day = a.dayChangePct === null ? "" : ` (${fmtPct(a.dayChangePct)})`;
  const stale = a.date !== today ? ` [資料日 ${a.date}]` : "";
  const ma = ["  均線乖離率"];
  for (const m of a.mas) {
    ma.push(
      m.deviationPct === null
        ? `    MA${m.period} —`
        : `    MA${m.period} ${fmtPct(m.deviationPct)} ${m.deviationPct >= 0 ? "✅" : "❌"}`,
    );
  }
  if (a.alignment) ma.push(`  ${ALIGNMENT_LABEL[a.alignment]}`);

  const crosses = a.mas
    .filter((m) => m.cross)
    .map((m) => `${m.cross === "up" ? "站上" : "跌破"} MA${m.period}`);
  if (crosses.length > 0) ma.push(`  🔔 ${crosses.join("、")}`);

  const yearNote = a.week52.bars < WEEK52_BARS ? `(僅${a.week52.bars}日)` : "";

  // 分段和 /explain 的段落一致，每段之間空一行
  const sections = [
    [`${title}  ${fmtPrice(a.close)}${day}${stale}`],
    [`  ${TREND_LABEL[a.trend]}｜${a.rangeBars}日 ${fmtPct(a.change.pct)} (${fmtSigned(a.change.abs)})｜多${a.votes.up}/空${a.votes.down}`],
    [
      `  斜率 ${fmtPct(a.regression.slopePctPerDay, 2)}/日 R² ${a.regression.r2.toFixed(2)}｜` +
        `${a.candles.red}紅${a.candles.black}黑${a.candles.flat}平｜${STRUCTURE_LABEL[a.structure]}`,
    ],
    ma,
    [
      `  位階 ${a.percentile.bars}日 ${a.percentile.value.toFixed(0)}%｜` +
        `52週${yearNote} 距高 ${fmtPct(a.week52.fromHighPct)} 距低 ${fmtPct(a.week52.fromLowPct)}`,
    ],
  ];
  return sections.map((s) => s.join("\n")).join("\n\n");
}

/** 依 Telegram 長度上限切成多則訊息，不會把單一股票拆開 */
export function formatReport(today: string, global: StockConfig, results: StockResult[], errors: string[] = []): string[] {
  const count = (t: Trend) => results.filter((r) => r.analysis?.trend === t).length;
  const header =
    `📊 台股監測 ${today}（預設區間 ${global.rangeDays} 日）\n` +
    `偏多 ${count("up")}｜偏空 ${count("down")}｜盤整 ${count("sideways")}`;

  const blocks = [header, ...results.map((r) => formatStock(r, today))];
  if (errors.length > 0) blocks.push(formatSyncErrors(errors));
  return splitMessages(blocks);
}

export function formatSyncErrors(errors: string[]): string {
  return `⚠️ 更新失敗\n${errors.map((e) => `  ${e}`).join("\n")}`;
}
