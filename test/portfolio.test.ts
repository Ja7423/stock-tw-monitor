import { describe, expect, it } from "vitest";
import {
  PENDING_TRADE_ID,
  avgCost,
  buildHoldings,
  buildTrend,
  dailyPnl,
  replayTrades,
  summarizePortfolio,
  valuePosition,
  type PositionState,
} from "../src/portfolio";
import { bar, trade } from "./helpers";

const cathay = { discount: 0.28, minFee: 1, minFeeOdd: 1 };
const noFee = { discount: 0, minFee: 0, minFeeOdd: 0 };

function replayOk(...args: Parameters<typeof replayTrades>): PositionState {
  const result = replayTrades(...args);
  if (!result.ok) throw new Error(`unexpected negative on ${result.negativeOn}`);
  return result.position;
}

describe("replayTrades", () => {
  it("分批買進的均價含手續費，賣出後均價不變", () => {
    const p = replayOk([
      trade(1, "buy", "2026-10-01", { shares: 1000, price: 100, fee: 40 }),
      trade(2, "buy", "2026-10-02", { shares: 1000, price: 110, fee: 44 }),
      trade(3, "sell", "2026-10-03", { shares: 500, price: 120, fee: 24, tax: 180 }),
    ]);
    expect(p.shares).toBe(1500);
    expect(avgCost(p)).toBeCloseTo(105.042, 6);
    expect(p.realizedTrading).toBeCloseTo(7275, 6);
    expect(p.entries[2].realized).toBeCloseTo(7275, 6);
    expect(p.entries[0].realized).toBeNull();
  });

  it("歸零後再買進，均價從頭算", () => {
    const p = replayOk([
      trade(1, "buy", "2026-10-01", { shares: 1000, price: 100 }),
      trade(2, "sell", "2026-10-02", { shares: 1000, price: 90 }),
      trade(3, "buy", "2026-10-03", { shares: 100, price: 50, fee: 1 }),
    ]);
    expect(avgCost(p)).toBeCloseTo(50.01, 6);
    expect(p.realizedTrading).toBe(-10_000);
  });

  it("補登較早的買進會更正均價與之後賣出的損益", () => {
    const trades = [
      trade(1, "buy", "2026-10-10", { shares: 1000, price: 100, fee: 40 }),
      trade(2, "sell", "2026-10-20", { shares: 500, price: 120, fee: 24, tax: 180 }),
    ];
    const backdated = trade(PENDING_TRADE_ID, "buy", "2026-10-05", { shares: 1000, price: 80, fee: 32 });
    const p = replayOk([...trades, backdated]);
    expect(p.shares).toBe(1500);
    expect(p.realizedTrading).toBeCloseTo(14_778, 6);
    expect(p.entries.map((e) => e.trade.id)).toEqual([PENDING_TRADE_ID, 1, 2]);
  });

  it("同一天依編號排序", () => {
    const result = replayTrades([
      trade(5, "buy", "2026-10-10", { shares: 1000, price: 100 }),
      trade(3, "sell", "2026-10-10", { shares: 1000, price: 100 }),
    ]);
    expect(result).toEqual({ ok: false, negativeOn: "2026-10-10" });
  });

  it("刪掉一筆買進後，之後的賣出會讓股數變負", () => {
    const remaining = [
      trade(2, "buy", "2026-10-05", { shares: 1000, price: 100 }),
      trade(3, "sell", "2026-10-10", { shares: 1500, price: 110 }),
    ];
    expect(replayTrades(remaining)).toEqual({ ok: false, negativeOn: "2026-10-10" });
  });

  it("股票股利以 0 成本加入，現金股利只算已實現", () => {
    const p = replayOk([
      trade(1, "buy", "2026-07-01", { shares: 1000, price: 100 }),
      trade(2, "stock_dividend", "2026-08-01", { shares: 100 }),
      trade(3, "cash_dividend", "2026-09-01", { amount: 3000 }),
    ]);
    expect(p.shares).toBe(1100);
    expect(avgCost(p)).toBeCloseTo(90.909, 3);
    expect(p.realizedDividend).toBe(3000);
    expect(p.realizedTrading).toBe(0);
  });

  it("不修改傳入的陣列", () => {
    const trades = [trade(2, "buy", "2026-10-02", { shares: 1 }), trade(1, "buy", "2026-10-01", { shares: 1 })];
    replayTrades(trades);
    expect(trades.map((t) => t.id)).toEqual([2, 1]);
  });
});

describe("valuePosition", () => {
  it("淨值扣掉預估的賣出手續費與證交稅", () => {
    const p = replayOk([trade(1, "buy", "2026-10-01", { shares: 1000, price: 100, fee: 40 })]);
    const v = valuePosition("2330", p, bar("2026-10-30", 120), cathay);
    expect(v.marketValue).toBe(120_000);
    expect(v.netValue).toBe(120_000 - 47 - 360);
    expect(v.unrealized).toBe(19_553);
    expect(v.unrealizedPct).toBeCloseTo((19_553 / 100_040) * 100, 6);
    expect(v.closeDate).toBe("2026-10-30");
  });
});

describe("buildHoldings / summarizePortfolio", () => {
  it("已出清的股票只算已實現，沒有價格的另外計數", () => {
    const trades = [
      trade(1, "buy", "2026-10-01", { stockId: "2330", shares: 1000, price: 100 }),
      trade(2, "buy", "2026-10-01", { stockId: "2317", shares: 1000, price: 50 }),
      trade(3, "sell", "2026-10-02", { stockId: "2317", shares: 1000, price: 60 }),
      trade(4, "buy", "2026-10-02", { stockId: "5274", shares: 10, price: 3000 }),
    ];
    const bars = new Map([["2330", [bar("2026-10-02", 110)]]]);
    const holdings = buildHoldings(trades, bars, noFee);
    expect(holdings.map((h) => h.stockId)).toEqual(["2330", "2317", "5274"]);
    const totals = summarizePortfolio(holdings);
    expect(totals.cost).toBe(100_000);
    expect(totals.realizedTrading).toBe(10_000);
    expect(totals.unpriced).toBe(1);
    // 2330 的 0.3% 證交稅
    expect(totals.netValue).toBe(110_000 - 330);
  });
});

describe("buildTrend", () => {
  // 債券 ETF 沒有證交稅、手續費設 0，淨值等於市值，方便驗算
  const bars = new Map([
    ["00679B", [bar("2026-10-01", 100), bar("2026-10-02", 110), bar("2026-10-04", 120)]],
    ["00720B", [bar("2026-10-03", 50), bar("2026-10-04", 55)]],
  ]);
  const trades = [
    trade(1, "buy", "2026-10-01", { stockId: "00679B", shares: 1000, price: 100 }),
    trade(2, "buy", "2026-10-03", { stockId: "00720B", shares: 1000, price: 50 }),
  ];

  it("每個交易日估值，停牌時沿用最後收盤價", () => {
    const points = buildTrend(trades, bars, 60, noFee);
    expect(points.map((p) => p.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(points.map((p) => p.netValue)).toEqual([100_000, 110_000, 160_000, 175_000]);
    expect(points[2].unrealizedPct).toBeCloseTo((10_000 / 150_000) * 100, 6);
    expect(points[3].totalPnl).toBe(25_000);
  });

  it("只取最後 N 天", () => {
    expect(buildTrend(trades, bars, 2, noFee).map((p) => p.date)).toEqual(["2026-10-03", "2026-10-04"]);
  });

  it("全部賣出後報酬率為 null，總損益保留已實現", () => {
    const sold = [...trades.slice(0, 1), trade(3, "sell", "2026-10-02", { stockId: "00679B", shares: 1000, price: 110 })];
    const points = buildTrend(sold, new Map([["00679B", bars.get("00679B")!]]), 60, noFee);
    expect(points[1]).toMatchObject({ unrealizedPct: null, totalPnl: 10_000, netValue: 0 });
  });

  it("沒有交易時回傳空陣列", () => {
    expect(buildTrend([], bars, 60, noFee)).toEqual([]);
  });
});

describe("dailyPnl", () => {
  it("當天買進投入的資金不算獲利", () => {
    const points = buildTrend(
      [
        trade(1, "buy", "2026-10-01", { stockId: "00679B", shares: 1000, price: 100 }),
        trade(2, "buy", "2026-10-02", { stockId: "00679B", shares: 1000, price: 110 }),
      ],
      new Map([["00679B", [bar("2026-10-01", 100), bar("2026-10-02", 110)]]]),
      60,
      noFee,
    );
    expect(dailyPnl(points)).toBe(10_000);
    expect(dailyPnl(points.slice(0, 1))).toBeNull();
  });
});

describe("buildTrend 的前一個收盤價", () => {
  it("交易日沒有 K 棒時用之前最近的收盤價", () => {
    const points = buildTrend(
      [trade(1, "buy", "2026-10-03", { stockId: "00679B", shares: 1000, price: 100 })],
      new Map([["00679B", [bar("2026-10-02", 100), bar("2026-10-03", 100), bar("2026-10-05", 105)]]]),
      60,
      { discount: 0, minFee: 0, minFeeOdd: 0 },
    );
    expect(points.map((p) => p.date)).toEqual(["2026-10-03", "2026-10-05"]);
    expect(points[1].unrealized).toBe(5000);
  });

  it("第一筆交易之前的 K 棒只用來帶入價格，不出現在趨勢裡", () => {
    const points = buildTrend(
      [
        trade(1, "buy", "2026-10-01", { stockId: "00679B", shares: 1000, price: 100 }),
        trade(2, "buy", "2026-10-03", { stockId: "00720B", shares: 1000, price: 50 }),
      ],
      new Map([
        ["00679B", [bar("2026-10-03", 100)]],
        ["00720B", [bar("2026-09-30", 50), bar("2026-10-03", 50)]],
      ]),
      60,
      { discount: 0, minFee: 0, minFeeOdd: 0 },
    );
    expect(points.map((p) => p.netValue)).toEqual([150_000]);
  });
});
