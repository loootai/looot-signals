import { describe, expect, it, vi } from "vitest";
import { FixtureRunner } from "@/demo/fixtureRunner";
import { fixtureBody } from "@/demo/fixtures";
import { planCalls, planTotal, runTriggers } from "./engine";
import { toCsv } from "./export";
import { LoootClient, type LoootRun, type LoootRunner } from "./looot";
import { parseFounders, parseInvestors } from "./parse";
import { ENDPOINT_IDS, FALLBACK_PRICES } from "./prices";
import { FOLLOW_UPS } from "./sources";
import { parseTriggers } from "./triggers";
import { EMPTY_STATE, type Signal, type SignalState } from "./types";

const NOW = new Date("2026-10-10T09:00:00.000Z");
const empty = (): SignalState => ({ ...EMPTY_STATE, signals: [], pending: {}, runs: [] });
const YAML = (extra = "") => `triggers:
  - id: rounds
    name: Rounds
    type: funding
    stages: [seed, series_a]
    limit: 20
    enrich: [founders, investors]
    enrichLimit: 2
${extra}`;
const TRIGGERS = parseTriggers(YAML());

describe("follow-up catalog entries", () => {
  it("pins the two Aviato endpoints at their catalog price per call", () => {
    expect(FOLLOW_UPS.founders).toMatchObject({ jobId: "company.founders", endpointId: "aviato-company-founders", unit: "call", fallbackMicros: 50_000, shapeVerified: false });
    expect(FOLLOW_UPS.investors).toMatchObject({ jobId: "company.funding", endpointId: "aviato-company-funding-rounds", unit: "call", fallbackMicros: 50_000, shapeVerified: false });
  });
  it("puts them in the endpoint list and the price fallback map", () => {
    expect(ENDPOINT_IDS).toContain("aviato-company-founders");
    expect(ENDPOINT_IDS).toContain("aviato-company-funding-rounds");
    expect(FALLBACK_PRICES["aviato-company-founders"]).toBe(50_000);
    expect(FALLBACK_PRICES["aviato-company-funding-rounds"]).toBe(50_000);
  });
  it("sends the company website with the page fields the endpoints require", () => {
    expect(FOLLOW_UPS.founders.inputFor("brightpath.example")).toEqual({ website: "brightpath.example", page: 0, perPage: 5 });
    expect(FOLLOW_UPS.investors.inputFor("brightpath.example")).toEqual({ website: "brightpath.example", page: 0, perPage: 5 });
  });
});

describe("parseFounders", () => {
  it("reads names, titles and LinkedIn links from the fixture", () => {
    const f = parseFounders(fixtureBody("aviato-company-founders", { website: "brightpath.example", page: 0, perPage: 5 }, NOW));
    expect(f).toEqual([
      { name: "Maya Okafor", title: "Co-founder and CEO", linkedinUrl: "https://www.linkedin.com/in/maya-okafor-example" },
      { name: "Luis Brandt", title: "Co-founder and CTO", linkedinUrl: "https://www.linkedin.com/in/luis-brandt-example" },
    ]);
  });
  it("is tolerant of other field names and joins first and last name", () => {
    expect(parseFounders({ data: [{ firstName: "Ana", lastName: "Silva", title: "CEO", linkedin_url: "https://www.linkedin.com/in/ana" }] })).toEqual([{ name: "Ana Silva", title: "CEO", linkedinUrl: "https://www.linkedin.com/in/ana" }]);
  });
  it("returns nothing for an answer it does not understand", () => {
    expect(parseFounders({ error: "x" })).toEqual([]);
    expect(parseFounders(null)).toEqual([]);
    expect(parseFounders({ items: [{ id: "1" }] })).toEqual([]);
  });
});

describe("parseInvestors", () => {
  it("lists the investors of the latest round from the fixture", () => {
    const r = parseInvestors(fixtureBody("aviato-company-funding-rounds", { website: "brightpath.example", page: 0, perPage: 5 }, NOW));
    expect(r).toEqual(["Stonebridge Ventures", "Alder Capital"]);
  });
  it("uses the round with the newest announcedOn, whatever the order", () => {
    const body = { fundingRounds: [{ announcedOn: "2024-01-01", investors: [{ name: "Old Fund" }] }, { announcedOn: "2026-09-30", investors: [{ name: "New Fund" }, "Angel One"] }] };
    expect(parseInvestors(body)).toEqual(["New Fund", "Angel One"]);
  });
  it("falls back to older rounds when the newest names no investor", () => {
    const body = { fundingRounds: [{ announcedOn: "2026-09-30", investors: [] }, { announcedOn: "2025-01-01", investors: [{ name: "Old Fund" }] }] };
    expect(parseInvestors(body)).toEqual(["Old Fund"]);
  });
  it("removes duplicates and reads nested names", () => {
    expect(parseInvestors({ fundingRounds: [{ announcedOn: "2026-01-01", investors: [{ investor: { name: "A" } }, { name: "A" }, { company: { name: "B" } }] }] })).toEqual(["A", "B"]);
  });
  it("returns nothing for an answer it does not understand", () => {
    expect(parseInvestors({})).toEqual([]);
    expect(parseInvestors("x")).toEqual([]);
  });
});

describe("trigger file", () => {
  it("defaults to no follow-ups and 3 companies", () => {
    const t = parseTriggers("triggers:\n  - id: a\n    name: a\n    type: funding");
    expect(t[0]).toMatchObject({ enrich: [], enrichLimit: 3 });
  });
  it("reads enrich and enrichLimit and drops repeats", () => {
    const t = parseTriggers("triggers:\n  - id: a\n    name: a\n    type: funding\n    enrich: [founders, founders, investors]\n    enrichLimit: 4");
    expect(t[0]).toMatchObject({ enrich: ["founders", "investors"], enrichLimit: 4 });
  });
  it("rejects enrich on a trigger that is not a funding trigger on the funding source", () => {
    expect(() => parseTriggers("triggers:\n  - id: a\n    name: a\n    type: news\n    query: q\n    enrich: [founders]")).toThrow(/enrich/);
    expect(() => parseTriggers("triggers:\n  - id: a\n    name: a\n    type: funding\n    source: news\n    enrich: [founders]")).toThrow(/domain/);
  });
  it("bounds enrichLimit and rejects unknown follow-ups", () => {
    expect(() => parseTriggers("triggers:\n  - id: a\n    name: a\n    type: funding\n    enrichLimit: 11")).toThrow(/enrichLimit/);
    expect(() => parseTriggers("triggers:\n  - id: a\n    name: a\n    type: funding\n    enrich: [board]")).toThrow(/enrich/);
  });
});

describe("planCalls with follow-ups", () => {
  it("quotes each follow-up at its price times enrichLimit", () => {
    const plan = planCalls(TRIGGERS, FALLBACK_PRICES, NOW);
    expect(plan.map((c) => [c.endpointId, c.followUp ?? null, c.quotedMicros])).toEqual([
      ["predictleads-discover-financing-events", null, 200_000],
      ["aviato-company-founders", "founders", 100_000],
      ["aviato-company-funding-rounds", "investors", 100_000],
    ]);
    expect(planTotal(plan)).toBe(400_000);
  });
  it("uses a live catalog price when one is given", () => {
    const plan = planCalls(TRIGGERS, { ...FALLBACK_PRICES, "aviato-company-founders": 70_000 }, NOW);
    expect(plan[1].quotedMicros).toBe(140_000);
  });
});

describe("runTriggers with follow-ups", () => {
  const run = (looot: LoootRunner, extra: Partial<Parameters<typeof runTriggers>[0]> = {}) => runTriggers({ triggers: TRIGGERS, state: empty(), looot, prices: FALLBACK_PRICES, capMicros: 1_000_000, now: NOW, ...extra });

  it("looks up the newest enrichLimit new companies and attaches founders and investors", async () => {
    const looot = new FixtureRunner(NOW);
    const { state, run: r } = await run(looot);
    const followCalls = looot.calls.filter((c) => c.endpointId.startsWith("aviato-"));
    expect(followCalls.map((c) => [c.endpointId, c.input.website])).toEqual([
      ["aviato-company-founders", "brightpath.example"],
      ["aviato-company-founders", "kestrel.example"],
      ["aviato-company-funding-rounds", "brightpath.example"],
      ["aviato-company-funding-rounds", "kestrel.example"],
    ]);
    const bright = state.signals.find((s) => s.domain === "brightpath.example")!;
    expect(bright.founders?.map((f) => f.name)).toEqual(["Maya Okafor", "Luis Brandt"]);
    expect(bright.investors).toEqual(["Stonebridge Ventures", "Alder Capital"]);
    const tide = state.signals.find((s) => s.domain === "tidepool.example")!;
    expect(tide.founders).toBeUndefined();
    expect(r.calls.filter((c) => c.followUp)).toHaveLength(4);
    // 5 financing rows at $0.01, then 4 lookups at $0.05.
    expect(r.spentMicros).toBe(5 * 10_000 + 4 * 50_000);
    expect(r.calls.filter((c) => c.followUp).every((c) => c.costMicros === 50_000 && c.status === "completed")).toBe(true);
  });

  it("never looks a company up twice, and takes the next newest companies on the next run", async () => {
    const looot = new FixtureRunner(NOW);
    const first = await run(looot);
    const before = looot.calls.length;
    const second = await run(looot, { state: first.state });
    // Brightpath and Kestrel are done. Tidepool is the only company left without a lookup: 2 calls at $0.05.
    const more = looot.calls.slice(before).filter((c) => c.endpointId.startsWith("aviato-"));
    expect(more.map((c) => [c.endpointId, c.input.website])).toEqual([
      ["aviato-company-founders", "tidepool.example"],
      ["aviato-company-funding-rounds", "tidepool.example"],
    ]);
    expect(second.run.spentMicros).toBe(100_000);
    const third = await run(looot, { state: second.state });
    expect(third.run.spentMicros).toBe(0);
    expect(looot.calls.slice(before).filter((c) => c.endpointId.startsWith("aviato-"))).toHaveLength(2);
  });

  it("gives each follow-up its own stable idempotency key", async () => {
    const looot = new FixtureRunner(NOW);
    await run(looot);
    const keys = looot.calls.filter((c) => c.endpointId.startsWith("aviato-")).map((c) => c.idempotencyKey);
    expect(new Set(keys).size).toBe(4);
    expect(keys.every((k) => k.startsWith("looot-signals:rounds:aviato-") && k.endsWith(":2026-10-10"))).toBe(true);
    const again = new FixtureRunner(NOW);
    await run(again);
    expect(again.calls.filter((c) => c.endpointId.startsWith("aviato-")).map((c) => c.idempotencyKey)).toEqual(keys);
  });

  it("never crosses the server cap and records the skipped lookups", async () => {
    const looot = new FixtureRunner(NOW);
    const priced = { runAndWait: async (e: string, i: Record<string, unknown>, k: string) => ({ ...(await looot.runAndWait(e, i, k)), actualCost: FALLBACK_PRICES[e] === 10_000 ? 0.1 : (FALLBACK_PRICES[e] ?? 0) / 1e6 }), getRun: looot.getRun.bind(looot), calls: looot.calls };
    // funding call costs 0.1 here; 0.1 left for exactly two lookups at 0.05 each.
    const { run: r } = await run(priced, { capMicros: 200_000 });
    const follow = r.calls.filter((c) => c.followUp);
    expect(follow.filter((c) => c.status === "completed")).toHaveLength(2);
    expect(follow.filter((c) => c.status === "skipped_budget")).toHaveLength(2);
    expect(r.spentMicros).toBeLessThanOrEqual(200_000);
  });

  it("skips a follow-up whose live price could not be read", async () => {
    const looot = new FixtureRunner(NOW);
    const { run: r } = await run(looot, { unpriced: ["aviato-company-founders"] });
    expect(r.calls.filter((c) => c.followUp === "founders").every((c) => c.status === "skipped_price")).toBe(true);
    expect(looot.calls.some((c) => c.endpointId === "aviato-company-founders")).toBe(false);
    expect(looot.calls.some((c) => c.endpointId === "aviato-company-funding-rounds")).toBe(true);
  });

  it("keeps the funding signals when a lookup fails, and records the failure at $0", async () => {
    const inner = new FixtureRunner(NOW);
    const looot: LoootRunner = {
      getRun: vi.fn(),
      runAndWait: vi.fn(async (e: string, i: Record<string, unknown>, k: string): Promise<LoootRun> => (e === "aviato-company-founders" ? { runId: "bad", status: "failed", error: { code: "provider_error", message: "upstream 500" }, actualCost: 0 } : inner.runAndWait(e, i, k))),
    };
    const { state, run: r } = await run(looot);
    expect(state.signals.length).toBe(3);
    const failed = r.calls.filter((c) => c.followUp === "founders");
    expect(failed.every((c) => c.status === "failed" && c.costMicros === 0 && c.error?.includes("provider_error"))).toBe(true);
    expect(state.signals.find((s) => s.domain === "brightpath.example")?.investors).toEqual(["Stonebridge Ventures", "Alder Capital"]);
    expect(state.signals.find((s) => s.domain === "brightpath.example")?.founders).toBeUndefined();
  });

  it("marks a company with no founders found as looked up, so it is not paid for again", async () => {
    const looot: LoootRunner = { getRun: vi.fn(), runAndWait: vi.fn(async (e: string, i: Record<string, unknown>): Promise<LoootRun> => ({ runId: "r", status: "completed", result: e.startsWith("aviato-") ? { items: [] } : fixtureBody(e, i, NOW), actualCost: "0.05" })) };
    const first = await run(looot);
    expect(first.state.signals.find((s) => s.domain === "brightpath.example")?.founders).toEqual([]);
    const calls = vi.mocked(looot.runAndWait).mock.calls.length;
    await run(looot, { state: first.state });
    const again = vi.mocked(looot.runAndWait).mock.calls.slice(calls).filter(([e]) => e.startsWith("aviato-"));
    expect(again.map(([, i]) => i.website)).not.toContain("brightpath.example");
    expect(again.map(([, i]) => i.website)).not.toContain("kestrel.example");
  });

  it("reads a lookup still running at the provider again, free, on the next run", async () => {
    const inner = new FixtureRunner(NOW);
    let slow = true;
    const looot: LoootRunner = {
      runAndWait: vi.fn(async (e: string, i: Record<string, unknown>, k: string): Promise<LoootRun> => (e === "aviato-company-founders" && slow ? { runId: `slow-${i.website}`, status: "running" } : inner.runAndWait(e, i, k))),
      getRun: vi.fn(async (id: string): Promise<LoootRun> => ({ runId: id, status: "completed", result: fixtureBody("aviato-company-founders", { website: id.replace("slow-", "") }, NOW), actualCost: "0.05" })),
    };
    const first = await run(looot);
    expect(first.run.calls.filter((c) => c.followUp === "founders").every((c) => c.status === "pending")).toBe(true);
    slow = false;
    const second = await run(looot, { state: first.state });
    expect(vi.mocked(looot.getRun)).toHaveBeenCalledTimes(2);
    expect(second.state.signals.find((s) => s.domain === "brightpath.example")?.founders).toHaveLength(2);
    expect(second.state.pending).toEqual({});
  });

  it("makes no follow-up call for a trigger without enrich", async () => {
    const plain = parseTriggers("triggers:\n  - id: rounds\n    name: Rounds\n    type: funding\n    limit: 20");
    const looot = new FixtureRunner(NOW);
    await runTriggers({ triggers: plain, state: empty(), looot, prices: FALLBACK_PRICES, capMicros: 1_000_000, now: NOW });
    expect(looot.calls.every((c) => !c.endpointId.startsWith("aviato-"))).toBe(true);
  });
});

describe("mocked HTTP", () => {
  it("posts the pinned endpoint, the website input and the idempotency key to /v1/runs", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ runId: "r1", status: "completed", result: fixtureBody("aviato-company-founders", { website: "brightpath.example" }, NOW), actualCost: "0.05" })));
    const client = new LoootClient({ token: "tok", fetch: f as unknown as typeof fetch });
    const { state } = await runTriggers({ triggers: TRIGGERS.map((t) => ({ ...t, enrich: ["founders" as const], enrichLimit: 1 })), state: empty(), looot: { runAndWait: (e, i, k) => (e.startsWith("aviato-") ? client.runAndWait(e, i, k) : new FixtureRunner(NOW).runAndWait(e, i, k)), getRun: (id) => client.getRun(id) }, prices: FALLBACK_PRICES, capMicros: 1_000_000, now: NOW });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.looot.ai/v1/runs?wait=30");
    expect(JSON.parse(String(init.body))).toMatchObject({ endpointId: "aviato-company-founders", input: { website: "brightpath.example", page: 0, perPage: 5 }, idempotencyKey: expect.stringContaining("looot-signals:rounds:aviato-company-founders:") });
    expect(state.signals.find((s) => s.domain === "brightpath.example")?.founders).toHaveLength(2);
  });
});

describe("exports", () => {
  const sig: Signal = { id: "1", company: "Brightpath", domain: "brightpath.example", headline: "Funding: seed", evidenceUrl: null, occurredAt: null, triggerId: "t", triggerName: "T", alsoTriggers: [], type: "funding", source: "funding", endpointId: "e", firstSeenAt: "2026-10-10T00:00:00.000Z", runId: "r", founders: [{ name: "Maya Okafor", title: "CEO", linkedinUrl: null }], investors: ["Stonebridge Ventures", "Alder Capital"] };
  it("adds founders and investors columns to the CSV", () => {
    const [head, row] = toCsv([sig]).split("\n");
    expect(head.endsWith("founders,investors")).toBe(true);
    expect(row).toContain("Maya Okafor (CEO)");
    expect(row).toContain("Stonebridge Ventures; Alder Capital");
  });
  it("leaves the columns empty for a signal that was not looked up", () => {
    const row = toCsv([{ ...sig, founders: undefined, investors: undefined }]).split("\n")[1];
    expect(row.endsWith(",,")).toBe(true);
  });
});
