import { parseIntInRange } from "./config";

export interface FeeConfig {
  /** 手續費折扣，0.28 = 2.8 折 */
  discount: number;
  /** 整股每筆最低手續費 */
  minFee: number;
  /** 零股（股數未滿 1000）每筆最低手續費 */
  minFeeOdd: number;
}

// 國泰證券電子下單 2.8 折、最低 1 元；可用 /set fee、/set feemin、/set feeminodd 改
export const DEFAULT_FEE_CONFIG: FeeConfig = { discount: 0.28, minFee: 1, minFeeOdd: 1 };

export const FEE_RATE = 0.001425;
const BOARD_LOT = 1000;

const TAX_RATE = { stock: 0.003, etf: 0.001, bondEtf: 0 } as const;

const FEE_LIMITS = { discount: [0.01, 1], minFee: [0, 100] } as const;

// 金額乘上小數費率會有浮點誤差（例如 1.4249999），先加一點再捨去
const EPSILON = 1e-6;
const floorAmount = (n: number) => Math.floor(n + EPSILON);

/** 證交稅率：00 開頭為 ETF，再以 B 結尾為債券 ETF（停徵） */
export function taxRateFor(stockId: string): number {
  if (!stockId.startsWith("00")) return TAX_RATE.stock;
  return stockId.endsWith("B") ? TAX_RATE.bondEtf : TAX_RATE.etf;
}

/** 手續費 = max(⌊金額 × 0.1425% × 折扣⌋, 最低手續費) */
export function calcFee(amount: number, shares: number, cfg: FeeConfig): number {
  const min = shares < BOARD_LOT ? cfg.minFeeOdd : cfg.minFee;
  return Math.max(floorAmount(amount * FEE_RATE * cfg.discount), min);
}

/** 賣出時的證交稅 */
export function calcTax(stockId: string, amount: number): number {
  return floorAmount(amount * taxRateFor(stockId));
}

function parseDiscount(raw: string): number {
  const n = Number(raw);
  const [min, max] = FEE_LIMITS.discount;
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`手續費折扣必須是 ${min}~${max} 的數字（0.28 = 2.8 折），收到「${raw}」`);
  }
  return n;
}

const FEE_PARSERS: Record<string, (raw: string) => Partial<FeeConfig>> = {
  fee: (raw) => ({ discount: parseDiscount(raw) }),
  feemin: (raw) => ({ minFee: parseIntInRange(raw, FEE_LIMITS.minFee, "整股最低手續費") }),
  feeminodd: (raw) => ({ minFeeOdd: parseIntInRange(raw, FEE_LIMITS.minFee, "零股最低手續費") }),
};

/** 解析 /set fee 0.28、/set feemin 20、/set feeminodd 1；不是手續費的 key 回傳 null */
export function parseFeePatch(key: string, value: string): Partial<FeeConfig> | null {
  const parser = FEE_PARSERS[key.toLowerCase()];
  return parser ? parser(value) : null;
}

export function describeFeeConfig(cfg: Partial<FeeConfig>): string {
  const parts: string[] = [];
  if (cfg.discount !== undefined) parts.push(cfg.discount === 1 ? "手續費無折扣" : `手續費 ${+(cfg.discount * 10).toFixed(2)} 折`);
  if (cfg.minFee !== undefined) parts.push(`整股最低 ${cfg.minFee} 元`);
  if (cfg.minFeeOdd !== undefined) parts.push(`零股最低 ${cfg.minFeeOdd} 元`);
  return parts.join("｜");
}
