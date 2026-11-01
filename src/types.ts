export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ALLOWED_CHAT_ID: string;
  FINMIND_TOKEN: string;
}

export interface Bar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockConfig {
  rangeDays: number;
  maPeriods: number[];
  percentileDays: number;
}

export interface WatchItem {
  stockId: string;
  name: string;
  market: string | null;
  rangeDays: number | null;
  maPeriods: number[] | null;
  percentileDays: number | null;
}

export type TradeType = "buy" | "sell" | "cash_dividend" | "stock_dividend";

export interface Trade {
  id: number;
  stockId: string;
  type: TradeType;
  date: string; // YYYY-MM-DD
  /** 買賣與股票股利的股數；現金股利為 0 */
  shares: number;
  /** 買賣成交價；股利為 null */
  price: number | null;
  /** 現金股利入帳金額；其他類型為 0 */
  amount: number;
  fee: number;
  tax: number;
}

export type NewTrade = Omit<Trade, "id">;
