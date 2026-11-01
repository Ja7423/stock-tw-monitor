import { STOCK_ID_RE, parseIntInRange, parseStockId } from "./config";

export const TREND_DAYS = { default: 60, limits: [5, 250] } as const;

const MAX_SHARES = 100_000_000;
const MAX_PRICE = 100_000;
const MAX_AMOUNT = 1_000_000_000;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHORT_DATE_RE = /^(\d{1,2})\/(\d{1,2})$/;
const TREND_DAYS_RE = /^\d{1,3}$/;

function isRealDate(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** 2026-10-15 或 10/15（當成 today 的年份）；不能是未來的日期 */
export function parseTradeDate(raw: string, today: string): string {
  const short = SHORT_DATE_RE.exec(raw);
  const date = short ? `${today.slice(0, 4)}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}` : raw;
  if (!ISO_DATE_RE.test(date) || !isRealDate(date)) {
    throw new Error(`日期格式錯誤：「${raw}」，應為 2026-10-15 或 10/15`);
  }
  if (date > today) throw new Error(`不能記錄未來的日期：${date}`);
  return date;
}

function parsePositiveNumber(raw: string, max: number, label: string): number {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > max) throw new Error(`${label}必須是大於 0 的數字，收到「${raw}」`);
  return n;
}

const parseShares = (raw: string) => parseIntInRange(raw.replace(/,/g, ""), [1, MAX_SHARES], "股數");

export interface TradeArgs {
  stockId: string;
  shares: number;
  price: number;
  date: string;
  /** 有給就覆寫自動計算的手續費 */
  fee?: number;
  tax?: number;
}

const TRADE_USAGE = "格式：代號 股數 價格 [日期] [fee=手續費] [tax=證交稅]，例如 2330 1000 580.5 10/15";

/** /buy、/sell 的參數：代號 股數 價格 [日期] [fee=] [tax=]，順序固定，日期和 fee/tax 可省略 */
export function parseTradeArgs(args: string[], today: string): TradeArgs {
  const [rawId, rawShares, rawPrice, ...rest] = args;
  if (!rawPrice) throw new Error(TRADE_USAGE);
  const parsed: TradeArgs = {
    stockId: parseStockId(rawId),
    shares: parseShares(rawShares),
    price: parsePositiveNumber(rawPrice, MAX_PRICE, "價格"),
    date: today,
  };
  for (const token of rest) {
    const [key, value] = token.split("=");
    if (value === undefined) {
      parsed.date = parseTradeDate(token, today);
      continue;
    }
    const field = key.toLowerCase();
    if (field !== "fee" && field !== "tax") throw new Error(`未知參數「${key}」，可用：fee、tax`);
    parsed[field] = parseIntInRange(value, [0, MAX_AMOUNT], field === "fee" ? "手續費" : "證交稅");
  }
  return parsed;
}

export type DividendArgs =
  | { stockId: string; kind: "cash"; amount: number; date: string }
  | { stockId: string; kind: "stock"; shares: number; date: string };

const DIVIDEND_USAGE = "格式：/div 2330 cash 4500 [日期]（入帳金額）或 /div 2330 stock 50 [日期]（配股股數）";

/** /div 代號 cash 金額 [日期]、/div 代號 stock 股數 [日期] */
export function parseDividendArgs(args: string[], today: string): DividendArgs {
  const [rawId, rawKind, rawValue, rawDate, ...extra] = args;
  if (!rawValue || extra.length > 0) throw new Error(DIVIDEND_USAGE);
  const stockId = parseStockId(rawId);
  const date = rawDate ? parseTradeDate(rawDate, today) : today;
  switch (rawKind.toLowerCase()) {
    case "cash":
      return { stockId, kind: "cash", amount: parseIntInRange(rawValue.replace(/,/g, ""), [1, MAX_AMOUNT], "股利金額"), date };
    case "stock":
      return { stockId, kind: "stock", shares: parseShares(rawValue), date };
    default:
      throw new Error(DIVIDEND_USAGE);
  }
}

/** /tradedel 12 或 /tradedel #12 */
export function parseTradeId(args: string[]): number {
  const [raw] = args;
  if (!raw) throw new Error("請提供交易編號，例如 /tradedel 12（編號見 /pos）");
  return parseIntInRange(raw.replace(/^#/, ""), [1, Number.MAX_SAFE_INTEGER - 1], "交易編號");
}

/** /trend [代號] [天數]：4 位數以上是代號，1–3 位數是天數 */
export function parseTrendArgs(args: string[]): { stockId?: string; days: number } {
  const parsed: { stockId?: string; days: number } = { days: TREND_DAYS.default };
  for (const raw of args) {
    if (TREND_DAYS_RE.test(raw)) parsed.days = parseIntInRange(raw, TREND_DAYS.limits, "天數");
    else if (STOCK_ID_RE.test(raw.toUpperCase())) parsed.stockId = raw.toUpperCase();
    else throw new Error(`看不懂的參數「${raw}」，格式：/trend [代號] [天數]，例如 /trend 2330 60`);
  }
  return parsed;
}
