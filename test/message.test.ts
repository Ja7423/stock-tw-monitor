import { describe, expect, it } from "vitest";
import { TELEGRAM_LIMIT, splitMessages } from "../src/message";

describe("splitMessages", () => {
  it("沒超過上限時合成一則", () => {
    expect(splitMessages(["a", "b"], "\n")).toEqual(["a\nb"]);
  });

  it("超過上限時另起一則，不拆開單一 block", () => {
    const block = "x".repeat(1500);
    const messages = splitMessages([block, block, block], "\n");
    expect(messages).toEqual([`${block}\n${block}`, block]);
    expect(messages.every((m) => m.length <= TELEGRAM_LIMIT)).toBe(true);
  });
});
