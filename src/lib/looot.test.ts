import { describe, expect, it, vi } from "vitest";
import { LoootClient, LoootError, balanceUsdOf } from "./looot";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("LoootClient", () => {
  it("posts the run with the bearer token, wait and the idempotency key", async () => {
    const f = vi.fn(async () => json({ runId: "r1", status: "completed", result: { ok: 1 }, actualCost: "0.001" }));
    const c = new LoootClient({ token: "tok", fetch: f as unknown as typeof fetch });
    const run = await c.run("serper-news", { q: "x" }, "key-1");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.looot.ai/v1/runs?wait=30");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({ endpointId: "serper-news", input: { q: "x" }, idempotencyKey: "key-1" });
    expect(run.runId).toBe("r1");
  });
  it("polls a run that is still going, then stops at the timeout", async () => {
    const f = vi.fn(async (url: string) => (url.includes("/v1/runs/r1") ? json({ runId: "r1", status: "running" }) : json({ runId: "r1", status: "queued" })));
    let t = 0;
    const c = new LoootClient({ token: "t", fetch: f as unknown as typeof fetch, pollTimeoutMs: 20, pollIntervalMs: 10, sleep: async () => void (t += 10) });
    const spy = vi.spyOn(Date, "now").mockImplementation(() => t);
    const run = await c.runAndWait("e", {}, "k");
    spy.mockRestore();
    expect(run.status).toBe("running");
  });
  it("turns an error body into a LoootError", async () => {
    const c = new LoootClient({ token: "t", fetch: (async () => json({ error: { code: "insufficient_funds", message: "Top up" } }, 402)) as unknown as typeof fetch });
    await expect(c.run("e", {}, "k")).rejects.toMatchObject({ status: 402, code: "insufficient_funds", message: "Top up" });
    await expect(c.run("e", {}, "k")).rejects.toBeInstanceOf(LoootError);
  });
  it("finds a balance", () => {
    expect(balanceUsdOf({ balance: { availableUsd: "4.5" } })).toBe(4.5);
    expect(balanceUsdOf({})).toBeNull();
  });
});
