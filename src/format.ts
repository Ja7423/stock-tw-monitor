// 報告和持股共用的數字格式

const priceFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const moneyFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const fmtPrice = (n: number) => priceFormat.format(n);
export const fmtSigned = (n: number) => `${n >= 0 ? "+" : ""}${fmtPrice(n)}`;
export const fmtPct = (n: number, digits = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

/** 金額四捨五入到元；`|| 0` 把 -0 轉成 0，避免顯示「-0」 */
export const fmtMoney = (n: number) => moneyFormat.format(Math.round(n) || 0);
export const fmtSignedMoney = (n: number) => `${(Math.round(n) || 0) > 0 ? "+" : ""}${fmtMoney(n)}`;
