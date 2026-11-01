import { describe, expect, it } from "vitest";
import { buildHoldings, buildTrend, summarizePortfolio } from "../src/portfolio";
import { formatDailySummary, formatHoldings, formatPosition, formatTrend, sparkline, withNames } from "../src/portfolioReport";
import { bar, trade } from "./helpers";

const noFee = { discount: 0, minFee: 0, minFeeOdd: 0 };
const today = "2026-10-30";
const names = new Map([
  ["2330", "台積電"],
  ["2317", "鴻海"],
  ["0050", "元大台灣50"],
]);

const trades = [
  trade(1, "buy", "2026-10-01", { stockId: "2330", shares: 1000, price: 1000, fee: 400 }),
  trade(2, "buy", "2026-10-01", { stockId: "2317", shares: 2000, price: 200 }),
  trade(3, "buy", "2026-10-01", { stockId: "0050", shares: 100, price: 150 }),
  trade(4, "sell", "2026-10-29", { stockId: "0050", shares: 100, price: 160, fee: 1, tax: 16 }),
  trade(5, "cash_dividend", "2026-10-20", { stockId: "2330", amount: 4500 }),
];
const bars = new Map([
  ["2330", [bar("2026-10-29", 1040), bar("2026-10-30", 1050)]],
  ["2317", [bar("2026-10-29", 210)]],
  ["0050", [bar("2026-10-29", 160)]],
]);

function rows() {
  const holdings = buildHoldings(trades, bars, noFee);
  return { rows: withNames(holdings, names), totals: summarizePortfolio(holdings) };
}

describe("formatHoldings", () => {
  it("依淨值排序，不列已出清的股票，最後是總計", () => {
    const { rows: r, totals } = rows();
    const [msg] = formatHoldings(r, totals, today);
    expect(msg).toMatch(/^💼 持股（2 檔）/);
    expect(msg.indexOf("2330 台積電")).toBeLessThan(msg.indexOf("2317 鴻海"));
    expect(msg).not.toContain("0050");
    expect(msg).toContain("2317 鴻海  2,000 股 [資料日 2026-10-29]");
    expect(msg).toContain("均價 1,000.4｜現價 1,050｜淨值 1,046,850");
    expect(msg).toContain("累計已實現 +5,483（價差 +983｜股利 +4,500）");
  });

  it("沒有持股時提示用 /buy", () => {
    const [msg] = formatHoldings([], summarizePortfolio([]), today);
    expect(msg).toContain("目前沒有持股");
  });
});

describe("formatDailySummary", () => {
  it("多一行今日損益；沒有持股時不發", () => {
    const { rows: r, totals } = rows();
    const points = buildTrend(trades, bars, 2, noFee);
    const [msg] = formatDailySummary(r, totals, points, today);
    expect(msg).toMatch(/^💼 持股摘要 2026-10-30（2 檔）/);
    // 2330 漲 10 元 × 1000 股，扣掉多出來的 30 元預估證交稅
    expect(msg).toContain("今日損益 +9,970");
    expect(formatDailySummary([], summarizePortfolio([]), [], today)).toEqual([]);
  });
});

describe("formatPosition", () => {
  it("已出清的股票顯示交易紀錄與每筆賣出損益", () => {
    const row = rows().rows.find((h) => h.stockId === "0050")!;
    const [msg] = formatPosition(row, today);
    expect(msg).toContain("📄 0050 元大台灣50\n已出清");
    expect(msg).toContain("#3 2026-10-01 買 100 股 @ 150｜費 0");
    expect(msg).toContain("#4 2026-10-29 賣 100 股 @ 160｜費 1 稅 16｜損益 +983");
  });

  it("持有中的股票顯示成本與股利", () => {
    const row = rows().rows.find((h) => h.stockId === "2330")!;
    const [msg] = formatPosition(row, today);
    expect(msg).toContain("持有 1,000 股｜均價 1,000.4｜成本 1,000,400");
    expect(msg).toContain("#5 2026-10-20 現金股利 4,500");
  });
});

describe("formatTrend", () => {
  const points = Array.from({ length: 12 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, "0")}`,
    netValue: 100_000 + i * 1000,
    unrealized: i * 1000,
    unrealizedPct: i,
    totalPnl: i * 1000,
  }));

  it("每 5 個交易日一列，最後一列是最新的一天", () => {
    const msg = formatTrend("持股趨勢", points);
    expect(msg).toContain("📈 持股趨勢 2026-10-01 ~ 2026-10-12（12 交易日）");
    const rowsOut = msg.split("\n").filter((l) => /^\d{2}\/\d{2}｜/.test(l));
    expect(rowsOut.map((l) => l.slice(0, 5))).toEqual(["10/02", "10/07", "10/12"]);
    expect(rowsOut[2]).toBe("10/12｜+11.0%｜+11,000｜+11,000｜111,000");
    expect(msg).not.toMatch(/最高|最低/);
  });

  it("沒有資料時說明原因", () => {
    expect(formatTrend("持股趨勢", [])).toContain("還沒有可以計算趨勢的價格資料");
  });
});

describe("sparkline", () => {
  it("最低到最高對應到 ▁ 到 █，全部相同時畫中間", () => {
    expect(sparkline([0, 50, 100])).toBe("▁▅█");
    expect(sparkline([3, 3])).toBe("▄▄");
    expect(sparkline([])).toBe("");
  });
});
