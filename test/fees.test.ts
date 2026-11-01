import { describe, expect, it } from "vitest";
import { calcFee, calcTax, describeFeeConfig, parseFeePatch, taxRateFor } from "../src/fees";

const cathay = { discount: 0.28, minFee: 1, minFeeOdd: 1 };
const fullPrice = { discount: 1, minFee: 20, minFeeOdd: 1 };

describe("calcFee", () => {
  it("金額 × 0.1425% × 折扣，無條件捨去", () => {
    expect(calcFee(580_500, 1000, cathay)).toBe(231);
    expect(calcFee(1_000_000, 1000, fullPrice)).toBe(1425);
  });

  it("整股和零股各自套用最低手續費", () => {
    expect(calcFee(10_000, 1000, fullPrice)).toBe(20);
    expect(calcFee(500, 5, fullPrice)).toBe(1);
    expect(calcFee(500, 5, cathay)).toBe(1);
  });
});

describe("calcTax", () => {
  it("股票 0.3%、ETF 0.1%、債券 ETF 0%", () => {
    expect(calcTax("2330", 610_000)).toBe(1830);
    expect(calcTax("0050", 100_000)).toBe(100);
    expect(calcTax("006208", 100_000)).toBe(100);
    expect(calcTax("00679B", 100_000)).toBe(0);
    expect(taxRateFor("00631L")).toBe(0.001);
  });
});

describe("parseFeePatch", () => {
  it("解析三個手續費設定", () => {
    expect(parseFeePatch("fee", "0.6")).toEqual({ discount: 0.6 });
    expect(parseFeePatch("FEEMIN", "20")).toEqual({ minFee: 20 });
    expect(parseFeePatch("feeminodd", "1")).toEqual({ minFeeOdd: 1 });
  });

  it("不是手續費的 key 回傳 null，超出範圍丟錯", () => {
    expect(parseFeePatch("range", "20")).toBeNull();
    expect(() => parseFeePatch("fee", "2.8")).toThrow(/0.28 = 2.8 折/);
    expect(() => parseFeePatch("feemin", "-1")).toThrow();
  });
});

describe("describeFeeConfig", () => {
  it("折扣顯示成幾折", () => {
    expect(describeFeeConfig(cathay)).toBe("手續費 2.8 折｜整股最低 1 元｜零股最低 1 元");
    expect(describeFeeConfig({ discount: 1 })).toBe("手續費無折扣");
  });
});
