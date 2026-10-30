import { describe, expect, it } from "vitest";
import { STOCK_ID_RE, parseConfigPatch, parseMaList, resolveConfig } from "../src/config";

describe("parseMaList", () => {
  it("去重並排序", () => {
    expect(parseMaList("60,5,20,5")).toEqual([5, 20, 60]);
  });
  it("拒絕超出範圍", () => {
    expect(() => parseMaList("5,999")).toThrow();
    expect(() => parseMaList("abc")).toThrow();
  });
});

describe("parseConfigPatch", () => {
  it("解析多個參數", () => {
    expect(parseConfigPatch(["range=20", "ma=5,10", "pct=60"])).toEqual({
      rangeDays: 20,
      maPeriods: [5, 10],
      percentileDays: 60,
    });
  });
  it("錯誤參數會丟出例外", () => {
    expect(() => parseConfigPatch(["foo=1"])).toThrow(/未知參數/);
    expect(() => parseConfigPatch(["range"])).toThrow(/格式錯誤/);
    expect(() => parseConfigPatch(["range=1"])).toThrow();
  });
});

describe("resolveConfig", () => {
  it("個股覆寫優先", () => {
    const global = { rangeDays: 10, maPeriods: [5, 20], percentileDays: 120 };
    const item = { stockId: "2330", name: "台積電", market: "twse", rangeDays: 20, maPeriods: null, percentileDays: null };
    expect(resolveConfig(global, item)).toEqual({ rangeDays: 20, maPeriods: [5, 20], percentileDays: 120 });
  });
});

describe("STOCK_ID_RE", () => {
  it("接受股票與 ETF 代號", () => {
    for (const id of ["2330", "0050", "006208", "00631L"]) expect(STOCK_ID_RE.test(id)).toBe(true);
    for (const id of ["23", "abcd", "2330.TW"]) expect(STOCK_ID_RE.test(id)).toBe(false);
  });
});
