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
