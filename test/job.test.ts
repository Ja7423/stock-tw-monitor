import { describe, expect, it } from "vitest";
import { syncTargets, watchBackfillFrom } from "../src/job";

describe("syncTargets", () => {
  const today = "2026-11-01";

  it("監測清單和持股去重，兩邊都有時取較早的回補日，持股往前推 14 天", () => {
    const targets = syncTargets(
      ["2330", "2317"],
      [
        { stockId: "2330", firstDate: "2024-01-02" },
        { stockId: "0050", firstDate: "2026-10-01" },
      ],
      today,
    );
    expect(targets).toEqual([
      { stockId: "2330", backfillFrom: "2023-12-19" },
      { stockId: "2317", backfillFrom: watchBackfillFrom(today) },
      { stockId: "0050", backfillFrom: "2026-09-17" },
    ]);
  });

  it("持股比監測回補日晚時沿用監測的回補日", () => {
    expect(syncTargets(["2330"], [{ stockId: "2330", firstDate: "2026-10-01" }], today)).toEqual([
      { stockId: "2330", backfillFrom: watchBackfillFrom(today) },
    ]);
  });
});
