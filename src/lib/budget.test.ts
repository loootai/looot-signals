import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Budget, DEFAULT_LIMITS, HARD_EXPIRY_MS, RESERVE_TTL_MS } from "./budget";
import { planCalls, runTriggers } from "./engine";
import { LoootError, type LoootRun, type LoootRunner } from "./looot";
import { FALLBACK_PRICES } from "./prices";
import { parseTriggers } from "./triggers";
import { EMPTY_STATE, type SignalState } from "./types";
import { fixtureBody } from "@/demo/fixtures";

const now = new Date("2026-10-10T09:00:00Z");
const empty = (): SignalState => ({ ...EMPTY_STATE, signals: [], pending: {}, runs: [] });
const one = (id: string, stage = "seed") => parseTriggers(`triggers:\n  - id: ${id}\n    name: ${id}\n    type: funding\n    stages: [${stage}]\n    limit: 20\n`);
/** A call-priced trigger: one title, one call of $0.0005. */
const cheap = (id: string) => parseTriggers(`triggers:\n  - id: ${id}\n    name: ${id}\n    type: hiring\n    titles: ["${id}"]\n    limit: 5\n`);
const base = { prices: FALLBACK_PRICES, capMicros: 5_000_000, now };
let dir: string;
let file: string;
const open = () => new Budget(file);

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-"));
  file = join(dir, "budget.json");
});

function runner(answer: (n: number, endpointId: string, input: Record<string, unknown>) => LoootRun | Promise<LoootRun>) {
  const calls: string[] = [];
  const looot: LoootRunner = {
    async runAndWait(endpointId, input) {
      calls.push(endpointId);
      return answer(calls.length, endpointId, input);
    },
    async getRun() {
      throw new Error("getRun is not expected here");
    },
  };
  return { looot, calls };
}
const completed = (cost: number, endpointId = "predictleads-discover-financing-events", input: Record<string, unknown> = { limit: 20 }): LoootRun => ({ runId: `run_${Math.random().toString(36).slice(2, 8)}`, status: "completed", result: fixtureBody(endpointId, input, now), actualCost: cost });

describe("period budget", () => {
  it("has a default daily and monthly limit that the owner can change", async () => {
    const b = open();
    expect((await b.status(now)).limits).toEqual(DEFAULT_LIMITS);
    await b.setLimits({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
    expect((await open().status(now)).limits).toEqual({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
  });

  it("lets exactly one of two concurrent reservations through when their sum is over the budget", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all([open().reserve("k1", 700_000, now), open().reserve("k2", 700_000, now)]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(out.filter((r) => !r.ok)).toHaveLength(1);
    expect((await open().status(now)).day.reservedMicros).toBe(700_000);
  });

  it("holds under 25 concurrent reservations from separate handles", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all(Array.from({ length: 25 }, (_, i) => open().reserve(`k${i}`, 100_000, now)));
    expect(out.filter((r) => r.ok)).toHaveLength(10);
    const s = await open().status(now);
    expect(s.day.reservedMicros).toBe(1_000_000);
    expect(s.day.remainingMicros).toBe(0);
  });

  it("stops many small runs at the budget and says which limit it hit", async () => {
    await open().setLimits({ dailyMicros: 300_000, monthlyMicros: 300_000 });
    const b = open();
    let ok = 0;
    let last = "";
    for (let i = 0; i < 10; i++) {
      const r = await b.reserve(`s${i}`, 100_000, now);
      if (r.ok) ok++;
      else last = r.message;
    }
    expect(ok).toBe(3);
    expect(last).toMatch(/budget is reached/i);
  });

  it("counts a settled run against the day and the month, and a new day starts clean", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    await b.reserve("a", 400_000, now);
    await b.settle("a", "fp", 350_000, now);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(350_000);
    expect(s.month.usedMicros).toBe(350_000);
    const s2 = await b.status(new Date("2026-10-11T09:00:00Z"));
    expect(s2.day.usedMicros).toBe(0);
    expect(s2.month.usedMicros).toBe(350_000);
  });

  it("releases a reservation", async () => {
    const b = open();
    await b.reserve("a", 400_000, now);
    await b.release("a");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("rejects limits that are not positive or put the day above the month", async () => {
    const b = open();
    await expect(b.setLimits({ dailyMicros: 0, monthlyMicros: 1_000_000 })).rejects.toThrow();
    await expect(b.setLimits({ dailyMicros: 5_000_000, monthlyMicros: 1_000_000 })).rejects.toThrow(/daily/i);
    await expect(b.setLimits({ dailyMicros: Number.NaN, monthlyMicros: 1_000_000 })).rejects.toThrow();
  });
});

describe("reconciling reservations", () => {
  async function pendingReservation() {
    const b = open();
    await b.reserve("p", 10_000, now);
    await b.attach("p", "run_p");
    return b;
  }

  it("settles a late completion to the real cost", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "completed", result: { x: 1 }, actualCost: 0.0031 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(3_100);
  });

  it("keeps the reservation while the run is still going", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "running" }) }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(10_000);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases when the run ended failed with no charge", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "failed", actualCost: 0 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("keeps an unfetchable run reserved until the hard expiry, then releases it", async () => {
    const b = await pendingReservation();
    const broken = { getRun: async (): Promise<LoootRun> => { throw new LoootError("down", 503); } };
    await b.reconcile(broken, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(broken, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps a reservation that never got a run id until the hard expiry", async () => {
    const b = open();
    await b.reserve("crash", 10_000, now);
    const never = { getRun: async (): Promise<LoootRun> => { throw new Error("not called"); } };
    await b.reconcile(never, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(never, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
});

describe("idempotency keys", () => {
  it("carry no date and no clock time, and are the same all through one refresh period", () => {
    const t = one("rounds");
    const keys = (d: Date) => planCalls(t, FALLBACK_PRICES, d).map((c) => c.idempotencyKey);
    const a = keys(new Date("2026-10-10T00:00:01Z"));
    expect(keys(new Date("2026-10-10T23:59:59Z"))).toEqual(a);
    for (const k of a) expect(k).not.toMatch(/\d{4}-\d{2}-\d{2}|T\d{2}:/);
  });

  it("change only when the refresh period changes, so a fresh lookup is an explicit new request", () => {
    const t = one("rounds");
    const a = planCalls(t, FALLBACK_PRICES, new Date("2026-10-10T09:00:00Z"))[0].idempotencyKey;
    const b = planCalls(t, FALLBACK_PRICES, new Date("2026-10-11T09:00:00Z"))[0].idempotencyKey;
    expect(a).not.toBe(b);
  });

  it("are the same for the same normalised input, whatever the trigger is called", () => {
    const a = planCalls(one("first", "Seed"), FALLBACK_PRICES, now)[0].idempotencyKey;
    const b = planCalls(one("second", "seed"), FALLBACK_PRICES, now)[0].idempotencyKey;
    expect(a).toBe(b);
  });
});

describe("runTriggers with the budget", () => {
  it("does not charge a repeated identical request twice, even from a fresh state", async () => {
    const b = open();
    const first = runner(() => completed(0.05));
    const r1 = await runTriggers({ ...base, triggers: one("rounds"), state: empty(), looot: first.looot, ledger: b });
    const second = runner(() => completed(0.05));
    const r2 = await runTriggers({ ...base, triggers: one("rounds"), state: empty(), looot: second.looot, ledger: b });
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
    expect(r2.run.spentMicros).toBe(0);
    expect(r2.state.signals.length).toBe(r1.state.signals.length);
    expect((await b.status(now)).day.usedMicros).toBe(r1.run.spentMicros);
  });

  it("charges again once the refresh period has passed", async () => {
    const b = open();
    const a = runner(() => completed(0.05));
    await runTriggers({ ...base, triggers: one("rounds"), state: empty(), looot: a.looot, ledger: b });
    const later = new Date(now.getTime() + 25 * 3_600_000);
    const c = runner(() => completed(0.05));
    await runTriggers({ ...base, triggers: one("rounds"), state: empty(), looot: c.looot, ledger: b, now: later });
    expect(c.calls).toHaveLength(1);
  });

  it("keeps the total charged inside the budget when many runs start together", async () => {
    await open().setLimits({ dailyMicros: 500_000, monthlyMicros: 500_000 });
    let charged = 0;
    const slow = runner(async () => {
      await new Promise((r) => setTimeout(r, 15));
      charged += 200_000;
      return completed(0.2);
    });
    const runs = await Promise.all(Array.from({ length: 8 }, (_, i) => runTriggers({ ...base, triggers: one(`t${i}`, `stage_${i}`), state: empty(), looot: slow.looot, ledger: open() })));
    expect(slow.calls).toHaveLength(2);
    expect(charged).toBeLessThanOrEqual(500_000);
    const s = await open().status(now);
    expect(s.day.usedMicros).toBe(400_000);
    expect(s.day.reservedMicros).toBe(0);
    expect(runs.filter((r) => r.run.calls[0].status === "skipped_budget")).toHaveLength(6);
  });

  it("stops many small runs at the budget and says so", async () => {
    await open().setLimits({ dailyMicros: 2_000, monthlyMicros: 2_000 });
    const { looot, calls } = runner(() => completed(0.0005, "anyapi-run-linkedin-jobs-thin", { query: "x" }));
    let message = "";
    for (let i = 0; i < 10; i++) {
      const { run } = await runTriggers({ ...base, triggers: cheap(`job${i}`), state: empty(), looot, ledger: open() });
      if (run.calls[0].status === "skipped_budget") message = run.calls[0].error ?? "";
    }
    expect(calls).toHaveLength(4);
    expect((await open().status(now)).day.usedMicros).toBe(2_000);
    expect(message).toMatch(/budget is reached/i);
  });

  it("keeps the reservation of a pending call and never records it failed at zero", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "running" }));
    const { run, state } = await runTriggers({ ...base, triggers: one("rounds"), state: empty(), looot, ledger: b });
    expect(run.calls[0].status).toBe("pending");
    expect(Object.keys(state.pending)).toHaveLength(1);
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(200_000);
    expect(s.day.usedMicros).toBe(0);
  });

  it("settles a late completion to the real cost when the next run reads it back", async () => {
    const b = open();
    const slow = runner(() => ({ runId: "run_slow", status: "running" }));
    const first = await runTriggers({ ...base, triggers: one("rounds"), state: empty(), looot: slow.looot, ledger: b });
    const reread: LoootRunner = { runAndWait: async () => { throw new Error("must not pay again"); }, getRun: async () => ({ ...completed(0.12), runId: "run_slow" }) };
    const second = await runTriggers({ ...base, triggers: one("rounds"), state: first.state, looot: reread, ledger: b });
    expect(second.run.calls[0].status).toBe("completed");
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(120_000);
  });

  it("releases the reservation of a call that looot answered with an error", async () => {
    const b = open();
    const { looot } = runner(() => { throw new LoootError("bad input", 400, "invalid_input"); });
    const { run } = await runTriggers({ ...base, triggers: one("rounds"), state: empty(), looot, ledger: b });
    expect(run.calls[0].status).toBe("failed");
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases a run looot reports failed at no charge", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "r", status: "failed", actualCost: 0, error: { code: "provider_error" } }));
    await runTriggers({ ...base, triggers: one("rounds"), state: empty(), looot, ledger: b });
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps the reservation when the network fails and the outcome is unknown", async () => {
    const b = open();
    const { looot } = runner(() => { throw new TypeError("fetch failed"); });
    await runTriggers({ ...base, triggers: one("rounds"), state: empty(), looot, ledger: b });
    expect((await b.status(now)).day.reservedMicros).toBe(200_000);
  });

  it("still holds the per-run cap before the period budget", async () => {
    const b = open();
    const { looot, calls } = runner(() => completed(0.05));
    const { run } = await runTriggers({ ...base, capMicros: 100_000, triggers: one("rounds"), state: empty(), looot, ledger: b });
    expect(calls).toHaveLength(0);
    expect(run.calls[0].status).toBe("skipped_cap");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
});

describe("the budget file", () => {
  it("survives a damaged file by falling back to the defaults", async () => {
    writeFileSync(file, "{not json");
    expect((await open().status(now)).limits).toEqual(DEFAULT_LIMITS);
  });

  it("is not written when no ledger is passed", async () => {
    const { looot } = runner(() => completed(0));
    await runTriggers({ ...base, triggers: one("rounds"), state: empty(), looot });
    expect(() => readFileSync(file, "utf8")).toThrow();
  });
});
