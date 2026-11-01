import type { Bar, Trade, TradeType } from "../src/types";

/** 測試用交易：價格與費用預設為 0，只給需要的欄位 */
export function trade(id: number, type: TradeType, date: string, fields: Partial<Trade> = {}): Trade {
  return { id, stockId: "2330", type, date, shares: 0, price: null, amount: 0, fee: 0, tax: 0, ...fields };
}

export function bar(date: string, close: number): Bar {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}
