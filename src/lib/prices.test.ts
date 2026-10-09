import { describe, expect, it, vi } from "vitest";
import { FALLBACK_PRICES, fetchPrices, priceOfItem } from "./prices";

describe("priceOfItem", () => {
  it("reads a known price", () => expect(priceOfItem({ price: { state: "known", amountMicros: 1000, unit: "call" } })).toBe(1000));
  it("ignores an unknown or negative price", () => {
    expect(priceOfItem({ price: { state: "unknown" } })).toBeNull();
    expect(priceOfItem({ price: { state: "known", amountMicros: -1 } })).toBeNull();
    expect(priceOfItem(null)).toBeNull();
  });
});

describe("fetchPrices", () => {
  it("uses the catalog price when it can be read", async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify({ price: { state: "known", amountMicros: u.includes("serper-news") ? 1500 : 7 } })));
    const r = await fetchPrices(["serper-news", "theirstack-jobs-search"], { fetch: f as unknown as typeof fetch, now: new Date("2026-10-11T00:00:00Z") });
    expect(r.prices["serper-news"]).toBe(1500);
    expect(r.source).toBe("catalog");
    expect(r.unread).toEqual([]);
  });
  it("names endpoints it could not read and keeps their dated fallback", async () => {
    const f = vi.fn(async (u: string) => (u.includes("serper-news") ? new Response("{}", { status: 404 }) : new Response(JSON.stringify({ price: { state: "known", amountMicros: 5 } }))));
    const r = await fetchPrices(["serper-news", "theirstack-jobs-search"], { fetch: f as unknown as typeof fetch });
    expect(r.unread).toEqual(["serper-news"]);
    expect(r.source).toBe("fallback");
    expect(r.prices["serper-news"]).toBe(FALLBACK_PRICES["serper-news"]);
  });
});
