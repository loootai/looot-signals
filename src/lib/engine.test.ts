import { describe, expect, it, vi } from "vitest";
import { FixtureRunner } from "@/demo/fixtureRunner";
import { fixtureBody } from "@/demo/fixtures";
import { planCalls, planTotal, runTriggers } from "./engine";
import type { LoootRun, LoootRunner } from "./looot";
import { FALLBACK_PRICES } from "./prices";
import { parseTriggers } from "./triggers";
import { EMPTY_STATE, type SignalState } from "./types";

const NOW = new Date("2026-10-10T09:00:00.000Z");
const empty = (): SignalState => ({ ...EMPTY_STATE, signals: [], pending: {}, runs: [] });
const TRIGGERS = parseTriggers(`triggers:
  - id: gtm
    name: GTM engineer
    type: hiring
    titles: ["GTM engineer", "growth engineer"]
  - id: rounds
    name: Rounds
    type: funding
    stages: [seed]
    limit: 20
  - id: clay
    name: Clay ads
    type: hiring
    keywords: [Clay, n8n]
    limit: 10
`);

describe("planCalls", () => {
  it("quotes call-priced sources per call and result-priced sources at the limit", () => {
    const plan = planCalls(TRIGGERS, FALLBACK_PRICES, NOW);
    expect(plan.map((c) => [c.trigger.id, c.endpointId, c.quotedMicros])).toEqual([
      ["gtm", "anyapi-run-linkedin-jobs-thin", 500],
      ["gtm", "anyapi-run-linkedin-jobs-thin", 500],
      ["rounds", "predictleads-discover-financing-events", 200_000],
      ["clay", "theirstack-jobs-search", 327_000],
    ]);
    expect(planTotal(plan)).toBe(528_000);
  });
  it("skips disabled triggers", () => {
    const off = TRIGGERS.map((t) => ({ ...t, enabled: false }));
    expect(planCalls(off, FALLBACK_PRICES, NOW)).toEqual([]);
  });
  it("gives the same idempotency key to the same input inside one refresh period, and a new one in the next period", () => {
    const a = planCalls(TRIGGERS, FALLBACK_PRICES, NOW).map((c) => c.idempotencyKey);
    const b = planCalls(TRIGGERS, FALLBACK_PRICES, new Date("2026-10-10T20:00:00Z")).map((c) => c.idempotencyKey);
    const c = planCalls(TRIGGERS, FALLBACK_PRICES, new Date("2026-10-11T09:00:00Z")).map((c) => c.idempotencyKey);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe("runTriggers", () => {
  it("finds signals, dedupes across titles, and reports 0 new on a second run", async () => {
    const looot = new FixtureRunner(NOW);
    const first = await runTriggers({ triggers: TRIGGERS, state: empty(), looot, prices: FALLBACK_PRICES, capMicros: 1_000_000, now: NOW });
    expect(first.run.newSignals).toBe(first.state.signals.length);
    expect(first.run.newSignals).toBeGreaterThan(8);
    // "growth engineer" and "GTM engineer" both return Northwind or Brightpath rows; none appears twice.
    const ids = first.state.signals.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const second = await runTriggers({ triggers: TRIGGERS, state: first.state, looot, prices: FALLBACK_PRICES, capMicros: 1_000_000, now: NOW });
    expect(second.run.newSignals).toBe(0);
    expect(second.state.signals).toHaveLength(first.state.signals.length);
  });

  it("makes no call that would cross the cap", async () => {
    const inner = new FixtureRunner(NOW);
    // Charges the list price per call, the way the real service would.
    const looot = { calls: inner.calls, getRun: inner.getRun.bind(inner), runAndWait: async (e: string, i: Record<string, unknown>, k: string) => ({ ...(await inner.runAndWait(e, i, k)), actualCost: FALLBACK_PRICES[e] / 1e6 }) };
    const { run } = await runTriggers({ triggers: TRIGGERS, state: empty(), looot, prices: { ...FALLBACK_PRICES }, capMicros: 150_000, now: NOW });
    const byTrigger = Object.fromEntries(run.calls.map((c) => [`${c.triggerId}:${c.status}`, true]));
    expect(byTrigger["rounds:skipped_cap"]).toBe(true);
    expect(byTrigger["clay:skipped_cap"]).toBe(true);
    expect(looot.calls.map((c) => c.endpointId)).toEqual(["anyapi-run-linkedin-jobs-thin", "anyapi-run-linkedin-jobs-thin"]);
  });

  it("does not call an endpoint whose live price could not be read", async () => {
    const looot = new FixtureRunner(NOW);
    const { run } = await runTriggers({ triggers: TRIGGERS, state: empty(), looot, prices: FALLBACK_PRICES, unpriced: ["theirstack-jobs-search"], capMicros: 1_000_000, now: NOW });
    expect(run.calls.find((c) => c.triggerId === "clay")?.status).toBe("skipped_price");
    expect(looot.calls.some((c) => c.endpointId === "theirstack-jobs-search")).toBe(false);
  });

  it("records a failed call at $0 and keeps going", async () => {
    const looot: LoootRunner = {
      runAndWait: vi.fn(async (endpointId: string, input: Record<string, unknown>): Promise<LoootRun> => (endpointId === "predictleads-discover-financing-events" ? { runId: "bad", status: "failed", error: { code: "provider_error", message: "upstream 500" }, actualCost: 0 } : { runId: "ok", status: "completed", result: fixtureBody(endpointId, input, NOW), actualCost: "0.0005" })),
      getRun: vi.fn(),
    };
    const { run, state } = await runTriggers({ triggers: TRIGGERS, state: empty(), looot, prices: FALLBACK_PRICES, capMicros: 1_000_000, now: NOW });
    const failed = run.calls.find((c) => c.triggerId === "rounds")!;
    expect(failed).toMatchObject({ status: "failed", costMicros: 0 });
    expect(failed.error).toContain("provider_error");
    expect(state.signals.length).toBeGreaterThan(0);
    expect(run.spentMicros).toBe(500 + 500 + 500);
  });

  it("calls a run still in progress pending, never failed, and reads it again on the next run for free", async () => {
    const looot: LoootRunner = {
      runAndWait: vi.fn(async (): Promise<LoootRun> => ({ runId: "slow-1", status: "running" })),
      getRun: vi.fn(async (): Promise<LoootRun> => ({ runId: "slow-1", status: "completed", result: fixtureBody("predictleads-discover-financing-events", { limit: 20 }, NOW), actualCost: "0.1" })),
    };
    const only = TRIGGERS.filter((t) => t.id === "rounds");
    const first = await runTriggers({ triggers: only, state: empty(), looot, prices: FALLBACK_PRICES, capMicros: 1_000_000, now: NOW });
    expect(first.run.calls[0].status).toBe("pending");
    expect(first.run.newSignals).toBe(0);
    expect(Object.keys(first.state.pending)).toHaveLength(1);

    const second = await runTriggers({ triggers: only, state: first.state, looot, prices: FALLBACK_PRICES, capMicros: 1_000_000, now: NOW });
    expect(looot.runAndWait).toHaveBeenCalledTimes(1);
    expect(looot.getRun).toHaveBeenCalledWith("slow-1");
    expect(second.run.calls[0].status).toBe("completed");
    expect(second.run.newSignals).toBe(3);
    expect(second.state.pending).toEqual({});
    expect(second.run.spentMicros).toBe(0);
  });

  it("drops signals older than maxAgeDays", async () => {
    const strict = parseTriggers(`triggers:\n  - id: rounds\n    name: Rounds\n    type: funding\n    maxAgeDays: 10\n    limit: 20`);
    const { state } = await runTriggers({ triggers: strict, state: empty(), looot: new FixtureRunner(NOW), prices: FALLBACK_PRICES, capMicros: 1_000_000, now: NOW });
    expect(state.signals.map((s) => s.company)).toEqual(["Brightpath", "Kestrel Data"]);
  });

  it("counts a thrown network error as a failed call, not a crash", async () => {
    const looot: LoootRunner = { runAndWait: vi.fn(async () => Promise.reject(new Error("socket hang up"))), getRun: vi.fn() };
    const { run } = await runTriggers({ triggers: TRIGGERS.slice(0, 1), state: empty(), looot, prices: FALLBACK_PRICES, capMicros: 1_000_000, now: NOW });
    expect(run.calls.every((c) => c.status === "failed" && c.error === "socket hang up")).toBe(true);
  });
});
