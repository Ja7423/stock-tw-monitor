import type { Bar, Env } from "./types";

const BASE_URL = "https://api.finmindtrade.com/api/v4/data";
const USER_INFO_URL = "https://api.web.finmindtrade.com/v2/user_info";

interface FinMindResponse<T> {
  status: number;
  msg: string;
  data: T[];
}

interface PriceRow {
  date: string;
  stock_id: string;
  Trading_Volume: number;
  open: number;
  max: number;
  min: number;
  close: number;
}

interface InfoRow {
  stock_id: string;
  stock_name: string;
  type: string; // twse / tpex / emerging
}

const QUOTA_EXCEEDED = 402;

/** FinMind 回 402：token 這一小時的請求額度已用完 */
export class FinMindQuotaError extends Error {
  constructor() {
    super("FinMind 每小時請求額度已用完");
    this.name = "FinMindQuotaError";
  }
}

/** 呼叫 FinMind 並檢查 HTTP 與 body 的 status，額度用完丟 FinMindQuotaError */
async function request<T extends { status: number; msg: string }>(env: Env, url: URL): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.FINMIND_TOKEN}` } });
  if (res.status === QUOTA_EXCEEDED) throw new FinMindQuotaError();
  if (!res.ok) throw new Error(`FinMind HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as T;
  if (body.status === QUOTA_EXCEEDED) throw new FinMindQuotaError();
  if (body.status !== 200) throw new Error(`FinMind ${body.status}: ${body.msg}`);
  return body;
}

async function query<T>(env: Env, params: Record<string, string>): Promise<T[]> {
  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return (await request<FinMindResponse<T>>(env, url)).data;
}

export interface FinMindQuota {
  /** 這一小時已用的請求數 */
  used: number;
  /** 每小時上限 */
  limit: number;
}

interface UserInfoResponse {
  status: number;
  msg: string;
  user_count: number;
  api_request_limit: number;
}

/** 查詢 token 這一小時的請求用量 */
export async function fetchQuota(env: Env): Promise<FinMindQuota> {
  const body = await request<UserInfoResponse>(env, new URL(USER_INFO_URL));
  return { used: body.user_count, limit: body.api_request_limit };
}

/** 抓 startDate（含）之後的日K，已排除停牌或無成交的空K棒 */
export async function fetchDailyBars(env: Env, stockId: string, startDate: string): Promise<Bar[]> {
  const rows = await query<PriceRow>(env, { dataset: "TaiwanStockPrice", data_id: stockId, start_date: startDate });
  return rows
    .filter((r) => r.close > 0)
    .map((r) => ({ date: r.date, open: r.open, high: r.max, low: r.min, close: r.close, volume: r.Trading_Volume }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchStockInfo(env: Env, stockId: string): Promise<{ name: string; market: string } | null> {
  const rows = await query<InfoRow>(env, { dataset: "TaiwanStockInfo", data_id: stockId });
  const row = rows.find((r) => r.stock_id === stockId);
  return row ? { name: row.stock_name, market: row.type } : null;
}
