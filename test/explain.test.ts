import { describe, expect, it } from "vitest";
import { EXPLAIN } from "../src/explain";

describe("EXPLAIN", () => {
  it("可以用單一則 Telegram 訊息送出", () => {
    expect(EXPLAIN.length).toBeLessThanOrEqual(4000);
  });
});
