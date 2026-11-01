import { parseStockId } from "./config";
import { getFeeConfig } from "./db";
import { calcFee, calcTax } from "./fees";
import { fetchStockInfo } from "./finmind";
import { priceFrom, taipeiDate } from "./date";
import { ensureHistory, getSyncLoad } from "./job";
import { PENDING_TRADE_ID, buildHoldings, buildTrend, replayTrades, summarizePortfolio } from "./portfolio";
import {
  deleteTrade,
  getStockInfo,
  getTrade,
  insertTrade,
  listTrades,
  loadPortfolio,
  upsertStockInfo,
  type StockInfo,
} from "./portfolioDb";
import { formatHoldings, formatPosition, formatPositionLine, formatTradeLine, formatTrend, withNames } from "./portfolioReport";
import { syncLoadWarning } from "./status";
import { parseDividendArgs, parseTradeArgs, parseTradeId, parseTrendArgs } from "./tradeArgs";
import type { Env, NewTrade } from "./types";

/** 已知的股票直接用既有名稱；從沒出現過的才查 FinMind，查不到或失敗就不記錄 */
async function resolveStock(env: Env, stockId: string): Promise<StockInfo> {
  const info = (await getStockInfo(env.DB, stockId)) ?? (await fetchStockInfo(env, stockId));
  if (!info) throw new Error(`${stockId} 查無此股票`);
  await upsertStockInfo(env.DB, stockId, info);
  return info;
}

/** 回補失敗不影響交易成立，回傳要附在回覆裡的警告 */
async function backfillWarning(env: Env, trade: NewTrade, today: string): Promise<string[]> {
  try {
    await ensureHistory(env, trade.stockId, priceFrom(trade.date), today);
    return [];
  } catch (err) {
    return [`⚠️ 歷史價格稍後補抓（${(err as Error).message}）`];
  }
}

/** 先用全部交易重算一次，確認任何一天股數都不會變負，才寫入 */
async function saveTrade(env: Env, trade: NewTrade, name: string): Promise<string> {
  const pending = { ...trade, id: PENDING_TRADE_ID };
  const result = replayTrades([...(await listTrades(env.DB, trade.stockId)), pending]);
  if (!result.ok) return `❌ ${trade.stockId} 在 ${result.negativeOn} 的股數會變成負數，未記錄`;

  const id = await insertTrade(env.DB, trade);
  const entry = result.position.entries.find((e) => e.trade.id === PENDING_TRADE_ID);
  const today = taipeiDate(new Date());
  const lines = [
    `✅ ${[trade.stockId, name].filter(Boolean).join(" ")} 已記錄`,
    formatTradeLine({ trade: { ...trade, id }, realized: entry?.realized ?? null }),
    formatPositionLine(result.position),
    ...(await backfillWarning(env, trade, today)),
  ];
  const warning = syncLoadWarning(await getSyncLoad(env.DB, today));
  if (warning) lines.push(warning);
  return lines.join("\n");
}

async function recordTrade(env: Env, type: "buy" | "sell", args: string[]): Promise<string> {
  const a = parseTradeArgs(args, taipeiDate(new Date()));
  const info = await resolveStock(env, a.stockId);
  const fee = await getFeeConfig(env.DB);
  const amount = a.price * a.shares;
  const autoTax = type === "sell" ? calcTax(a.stockId, amount) : 0;
  return saveTrade(
    env,
    {
      stockId: a.stockId,
      type,
      date: a.date,
      shares: a.shares,
      price: a.price,
      amount: 0,
      fee: a.fee ?? calcFee(amount, a.shares, fee),
      tax: a.tax ?? autoTax,
    },
    info.name,
  );
}

export const handleBuy = (env: Env, args: string[]) => recordTrade(env, "buy", args);
export const handleSell = (env: Env, args: string[]) => recordTrade(env, "sell", args);

/** 股利只能記在有交易紀錄的股票上 */
export async function handleDiv(env: Env, args: string[]): Promise<string> {
  const d = parseDividendArgs(args, taipeiDate(new Date()));
  if ((await listTrades(env.DB, d.stockId)).length === 0) return `➖ 沒有 ${d.stockId} 的交易紀錄，請先 /buy`;
  const base = { stockId: d.stockId, date: d.date, price: null, fee: 0, tax: 0 };
  const trade: NewTrade =
    d.kind === "cash"
      ? { ...base, type: "cash_dividend", shares: 0, amount: d.amount }
      : { ...base, type: "stock_dividend", shares: d.shares, amount: 0 };
  return saveTrade(env, trade, (await getStockInfo(env.DB, d.stockId))?.name ?? "");
}

export async function handleTradeDel(env: Env, args: string[]): Promise<string> {
  const id = parseTradeId(args);
  const trade = await getTrade(env.DB, id);
  if (!trade) return `➖ 找不到交易 #${id}`;
  const remaining = (await listTrades(env.DB, trade.stockId)).filter((t) => t.id !== id);
  const result = replayTrades(remaining);
  if (!result.ok) return `❌ 刪除後 ${trade.stockId} 在 ${result.negativeOn} 的股數會變成負數，未刪除`;
  await deleteTrade(env.DB, id);
  return [`🗑 ${trade.stockId} 已刪除`, formatTradeLine({ trade, realized: null }), formatPositionLine(result.position)].join("\n");
}

export async function handleHoldings(env: Env): Promise<string[]> {
  const data = await loadPortfolio(env.DB);
  const holdings = buildHoldings(data.trades, data.bars, data.fee);
  return formatHoldings(withNames(holdings, data.names), summarizePortfolio(holdings), taipeiDate(new Date()));
}

export async function handlePos(env: Env, args: string[]): Promise<string | string[]> {
  const stockId = parseStockId(args[0]);
  const data = await loadPortfolio(env.DB, stockId);
  const [holding] = withNames(buildHoldings(data.trades, data.bars, data.fee), data.names);
  if (!holding) return `➖ 沒有 ${stockId} 的交易紀錄`;
  return formatPosition(holding, taipeiDate(new Date()));
}

export async function handleTrend(env: Env, args: string[]): Promise<string> {
  const { stockId, days } = parseTrendArgs(args);
  const data = await loadPortfolio(env.DB, stockId);
  if (data.trades.length === 0) return stockId ? `➖ 沒有 ${stockId} 的交易紀錄` : "目前沒有交易紀錄，用 /buy 記錄買進。";
  const title = stockId ? `${stockId} ${data.names.get(stockId) ?? ""}`.trim() : "持股趨勢";
  return formatTrend(title, buildTrend(data.trades, data.bars, days, data.fee));
}
