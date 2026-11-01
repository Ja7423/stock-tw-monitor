import type { StockConfig, WatchItem } from "./types";

export const DEFAULT_CONFIG: StockConfig = {
  rangeDays: 10,
  maPeriods: [5, 10, 20, 60, 120, 240],
  percentileDays: 120,
};

// 上限受限於回補的歷史長度（約 285 根 K 棒）
export const LIMITS = {
  rangeDays: [2, 120],
  percentileDays: [5, 250],
  maPeriod: [2, 240],
  maCount: 8,
} as const;

export const STOCK_ID_RE = /^\d{4,6}[A-Z]?$/;

// Cloudflare 免費方案每次執行約 50 個對外請求；每日排程每檔股票 1 個，再加上 Telegram 訊息
export const SUBREQUEST_LIMIT = 50;
export const SYNC_WARN_STOCKS = 40;

/** 單一股票代號，轉成大寫後驗證格式 */
export function parseStockId(raw: string | undefined): string {
  if (!raw) throw new Error("請提供股票代號，例如 2330");
  const id = raw.toUpperCase();
  if (!STOCK_ID_RE.test(id)) throw new Error(`股票代號格式錯誤：${raw}`);
  return id;
}

export function resolveConfig(global: StockConfig, item: WatchItem): StockConfig {
  return {
    rangeDays: item.rangeDays ?? global.rangeDays,
    maPeriods: item.maPeriods ?? global.maPeriods,
    percentileDays: item.percentileDays ?? global.percentileDays,
  };
}

export function parseIntInRange(raw: string, [min, max]: readonly [number, number], label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} 必須是 ${min}~${max} 的整數，收到「${raw}」`);
  }
  return n;
}

export function parseMaList(raw: string): number[] {
  const periods = [...new Set(raw.split(/[,，]/).filter(Boolean).map((s) => parseIntInRange(s.trim(), LIMITS.maPeriod, "均線週期")))];
  if (periods.length === 0) throw new Error("至少要設定一條均線，例如 ma=5,20,60");
  if (periods.length > LIMITS.maCount) throw new Error(`最多 ${LIMITS.maCount} 條均線`);
  return periods.sort((a, b) => a - b);
}

/** 解析 ["range=20", "ma=5,20", "pct=120"] 這類參數 */
export function parseConfigPatch(args: string[]): Partial<StockConfig> {
  if (args.length === 0) throw new Error("缺少參數，例如 range=20 ma=5,20,60 pct=120");
  const patch: Partial<StockConfig> = {};
  for (const arg of args) {
    const [key, value] = arg.split("=");
    if (!value) throw new Error(`參數格式錯誤：「${arg}」，應為 key=value`);
    switch (key.toLowerCase()) {
      case "range":
        patch.rangeDays = parseIntInRange(value, LIMITS.rangeDays, "觀察區間");
        break;
      case "ma":
        patch.maPeriods = parseMaList(value);
        break;
      case "pct":
        patch.percentileDays = parseIntInRange(value, LIMITS.percentileDays, "百分位區間");
        break;
      default:
        throw new Error(`未知參數「${key}」，可用：range、ma、pct`);
    }
  }
  return patch;
}

export function describeConfig(cfg: Partial<StockConfig>): string {
  const parts: string[] = [];
  if (cfg.rangeDays !== undefined) parts.push(`區間 ${cfg.rangeDays} 日`);
  if (cfg.maPeriods !== undefined) parts.push(`MA ${cfg.maPeriods.join("/")}`);
  if (cfg.percentileDays !== undefined) parts.push(`百分位 ${cfg.percentileDays} 日`);
  return parts.join("｜");
}
