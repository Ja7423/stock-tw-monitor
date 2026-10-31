import { afterEach, describe, expect, it, vi } from "vitest";
import { FinMindQuotaError, fetchDailyBars } from "../src/finmind";
import type { Env } from "../src/types";

const env = { FINMIND_TOKEN: "test" } as Env;

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => vi.unstubAllGlobals());

describe("FinMind 額度用完", () => {
  it("HTTP 402 丟出 FinMindQuotaError", async () => {
    stubFetch(402, { msg: "Requests reach the upper limit.", status: 402 });
    await expect(fetchDailyBars(env, "5274", "2026-10-01")).rejects.toBeInstanceOf(FinMindQuotaError);
  });

  it("HTTP 200 但 body status 402 也丟出 FinMindQuotaError", async () => {
    stubFetch(200, { msg: "Requests reach the upper limit.", status: 402, data: [] });
    await expect(fetchDailyBars(env, "5274", "2026-10-01")).rejects.toBeInstanceOf(FinMindQuotaError);
  });

  it("其他錯誤維持一般 Error", async () => {
    stubFetch(500, { msg: "boom" });
    const err = await fetchDailyBars(env, "5274", "2026-10-01").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(FinMindQuotaError);
  });
});
