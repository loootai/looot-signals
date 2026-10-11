import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isAllowedWebhook, sendWebhook, toCsv } from "./export";
import type { Signal } from "./types";

const s = (over: Partial<Signal>): Signal => ({ id: "1", company: "Acme, Inc", domain: "acme.io", headline: "Hiring: GTM Engineer", evidenceUrl: "https://x.example/1", occurredAt: "2026-10-09T00:00:00.000Z", triggerId: "t", triggerName: "T", alsoTriggers: [], type: "hiring", source: "jobs_index", endpointId: "e", firstSeenAt: "2026-10-10T00:00:00.000Z", runId: "r", ...over });

describe("toCsv", () => {
  it("quotes commas and doubles quotes", () => {
    const csv = toCsv([s({ headline: 'He said "hi"' })]);
    expect(csv.split("\n")[1]).toContain('"Acme, Inc"');
    expect(csv).toContain('"He said ""hi"""');
  });
  it("stops spreadsheet formulas", () => {
    expect(toCsv([s({ headline: "=HYPERLINK(1)" })])).toContain("'=HYPERLINK(1)");
  });
  it("sorts newest first", () => {
    const csv = toCsv([s({ headline: "old", occurredAt: "2026-10-01T00:00:00Z" }), s({ headline: "new", occurredAt: "2026-10-09T00:00:00Z" })]);
    expect(csv.indexOf("new")).toBeLessThan(csv.indexOf("old"));
  });
});

describe("webhook", () => {
  it("allows https on a public host only", () => {
    expect(isAllowedWebhook("https://hooks.example/x")).toBe(true);
    expect(isAllowedWebhook("http://localhost:9000/x")).toBe(false);
    expect(isAllowedWebhook("http://hooks.example/x")).toBe(false);
    expect(isAllowedWebhook("file:///etc/passwd")).toBe(false);
  });
  it("posts the signals with an HMAC signature", async () => {
    const post = vi.fn(async (_t: { body: string; headers: Record<string, string> }) => 202);
    const status = await sendWebhook("https://hooks.example/x", [s({})], { secret: "k", post, lookup: async () => [{ address: "93.184.216.34", family: 4 }], now: new Date("2026-10-10T00:00:00Z") });
    expect(status).toBe(202);
    const init = post.mock.calls[0][0];
    const body = init.body;
    expect(JSON.parse(body)).toMatchObject({ source: "looot-signals", count: 1 });
    expect(init.headers["X-Signals-Signature"]).toBe(`sha256=${createHmac("sha256", "k").update(body).digest("hex")}`);
  });
  it("refuses a plain http target", async () => {
    await expect(sendWebhook("http://hooks.example/x", [])).rejects.toThrow(/https/);
  });
});
