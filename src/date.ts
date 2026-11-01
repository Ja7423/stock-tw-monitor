// 日期都用台北時間的 YYYY-MM-DD 字串

export function taipeiDate(now: Date): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 交易日不一定有 K 棒（週末、連假、停牌），估值要用交易日之前最近的收盤價；14 天涵蓋春節連假
export const PRICE_LOOKBACK_DAYS = 14;

/** 估值和回補持股日K的起點：第一筆交易往前推，確保拿得到前一個收盤價 */
export function priceFrom(firstTradeDate: string): string {
  return shiftDate(firstTradeDate, -PRICE_LOOKBACK_DAYS);
}
