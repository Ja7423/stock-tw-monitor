import { describe, expect, it } from "vitest";
import { parseDividendArgs, parseTradeArgs, parseTradeDate, parseTradeId, parseTrendArgs } from "../src/tradeArgs";

const today = "2026-11-01";

describe("parseTradeDate", () => {
  it("接受完整日期和當年的月/日", () => {
    expect(parseTradeDate("2026-10-15", today)).toBe("2026-10-15");
    expect(parseTradeDate("3/5", today)).toBe("2026-03-05");
  });

  it("拒絕格式錯誤、不存在的日期和未來日期", () => {
    expect(() => parseTradeDate("20261015", today)).toThrow(/日期格式錯誤/);
    expect(() => parseTradeDate("2026-02-30", today)).toThrow(/日期格式錯誤/);
    expect(() => parseTradeDate("11/02", today)).toThrow(/未來/);
  });
});

describe("parseTradeArgs", () => {
  it("日期與 fee/tax 都可省略", () => {
    expect(parseTradeArgs(["2330", "1000", "580.5"], today)).toEqual({
      stockId: "2330",
      shares: 1000,
      price: 580.5,
      date: today,
    });
  });

  it("解析日期與覆寫的手續費和稅，代號轉大寫", () => {
    expect(parseTradeArgs(["00631l", "1,500", "20", "10/15", "fee=5", "TAX=0"], today)).toEqual({
      stockId: "00631L",
      shares: 1500,
      price: 20,
      date: "2026-10-15",
      fee: 5,
      tax: 0,
    });
  });

  it("參數錯誤會丟出說明", () => {
    expect(() => parseTradeArgs(["2330", "1000"], today)).toThrow(/格式：代號 股數 價格/);
    expect(() => parseTradeArgs(["2330", "1.5", "580"], today)).toThrow(/股數/);
    expect(() => parseTradeArgs(["2330", "1000", "0"], today)).toThrow(/價格/);
    expect(() => parseTradeArgs(["2330", "1000", "580", "foo=1"], today)).toThrow(/未知參數/);
    expect(() => parseTradeArgs(["23", "1000", "580"], today)).toThrow(/代號格式錯誤/);
  });
});

describe("parseDividendArgs", () => {
  it("現金股利與股票股利", () => {
    expect(parseDividendArgs(["2330", "cash", "4,500"], today)).toEqual({ stockId: "2330", kind: "cash", amount: 4500, date: today });
    expect(parseDividendArgs(["2330", "STOCK", "50", "8/1"], today)).toEqual({
      stockId: "2330",
      kind: "stock",
      shares: 50,
      date: "2026-08-01",
    });
  });

  it("未知類型或參數太多時顯示用法", () => {
    expect(() => parseDividendArgs(["2330", "bonus", "50"], today)).toThrow(/格式：\/div/);
    expect(() => parseDividendArgs(["2330", "cash", "50", "8/1", "x"], today)).toThrow(/格式：\/div/);
  });
});

describe("parseTradeId", () => {
  it("接受有或沒有 # 的編號", () => {
    expect(parseTradeId(["12"])).toBe(12);
    expect(parseTradeId(["#12"])).toBe(12);
    expect(() => parseTradeId([])).toThrow(/交易編號/);
    expect(() => parseTradeId(["abc"])).toThrow();
  });
});

describe("parseTrendArgs", () => {
  it("1–3 位數是天數，其他是代號", () => {
    expect(parseTrendArgs([])).toEqual({ days: 60 });
    expect(parseTrendArgs(["2330", "120"])).toEqual({ stockId: "2330", days: 120 });
    expect(parseTrendArgs(["30"])).toEqual({ days: 30 });
    expect(() => parseTrendArgs(["999"])).toThrow(/天數/);
    expect(() => parseTrendArgs(["abc"])).toThrow(/看不懂/);
  });
});
