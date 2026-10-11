import { createHash } from "node:crypto";
import type { Ledger } from "./budget";
import { mergeSignals, signalId } from "./dedupe";
import { LoootError, TERMINAL_STATUSES, type LoootRun, type LoootRunner } from "./looot";
import { toMicros } from "./money";
import { parseFounders, parseInvestors, parseSource } from "./parse";
import { FOLLOW_UPS, SOURCES, callsFor, sourceFor } from "./sources";
import type { PriceMap } from "./prices";
import type { CallRecord, FollowUpId, RunRecord, Signal, SignalState, SourceId, Trigger } from "./types";
import { hash } from "./utils";

export interface PlannedCall {
  trigger: Trigger;
  source: SourceId;
  endpointId: string;
  label: string;
  input: Record<string, unknown>;
  /** Most this call can cost at the given prices. Result-priced calls are quoted at `limit` rows. */
  quotedMicros: number;
  /** Same endpoint, same normalised input, same refresh period: same key. The stored result answers a repeat, and looot replays the run if it is missing. */
  idempotencyKey: string;
  /** Set on the quote line of a per-company lookup. The run makes those calls one company at a time, after the searches. */
  followUp?: FollowUpId;
}

/** A search is a fresh request once a day. The period is a whole number, floor(time / 24 hours), never a date. */
export const REFRESH_MS = 86_400_000;
/** A founder or investor lookup is a fresh request once every 30 days. Who founded a company does not change by the day. */
export const LOOKUP_REFRESH_MS = 30 * 86_400_000;

/** Lowercases text, trims it and sorts object keys, so the same request always has the same shape. */
function normalise(v: unknown): unknown {
  if (typeof v === "string") return v.trim().toLowerCase();
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, normalise(x)]));
  return v;
}

/**
 * One key per endpoint and normalised input, plus the refresh period. No date, no clock time. Inside a period a repeated
 * request gets the same key. A new period is an explicit new request with its own key, so a feed can look again each day.
 * Inputs that carry a look-back date (job changes) change at UTC midnight, the same moment the daily period turns over.
 */
export function keyFor(endpointId: string, input: Record<string, unknown>, now: Date, periodMs: number = REFRESH_MS): string {
  return `looot-signals:${endpointId}:${hash(JSON.stringify(normalise(input)))}:p${Math.floor(now.getTime() / periodMs)}`;
}

/** Hash of what a paid call asks for: endpoint and normalised input. Guards a stored result against a short-key collision. */
export function callFingerprint(endpointId: string, input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify([endpointId, normalise(input)])).digest("hex");
}

/** Every call a run would make, with its quote. Makes no request. */
export function planCalls(triggers: Trigger[], prices: PriceMap, now: Date): PlannedCall[] {
  return triggers
    .filter((t) => t.enabled)
    .flatMap((trigger) => {
      const source = sourceFor(trigger);
      const def = SOURCES[source];
      const searches: PlannedCall[] = callsFor(trigger, now).map(({ label, input }) => {
        const unit = prices[def.endpointId] ?? def.fallbackMicros;
        const rows = typeof input.limit === "number" ? input.limit : 1;
        return {
          trigger,
          source,
          endpointId: def.endpointId,
          label,
          input,
          quotedMicros: def.unit === "result" ? unit * rows : unit,
          idempotencyKey: keyFor(def.endpointId, input, now),
        };
      });
      // One quote line per lookup kind: the price of one call times the most companies the trigger may look up.
      const lookups: PlannedCall[] = trigger.enrich.map((id) => {
        const f = FOLLOW_UPS[id];
        const unit = prices[f.endpointId] ?? f.fallbackMicros;
        const input = { enrichLimit: trigger.enrichLimit };
        return { trigger, source, endpointId: f.endpointId, label: `${f.label.toLowerCase()} of up to ${trigger.enrichLimit} new companies, ${f.jobId}`, input, quotedMicros: unit * trigger.enrichLimit, idempotencyKey: keyFor(f.endpointId, input, now, LOOKUP_REFRESH_MS), followUp: id };
      });
      return [...searches, ...lookups];
    });
}

/** What a plan can still cost: its total, less the calls a stored result already answers. Follow-up lines are always counted. */
export async function payableMicros(plan: PlannedCall[], ledger: Pick<Ledger, "recall">, now: Date): Promise<number> {
  let n = 0;
  for (const c of plan) n += c.followUp || !(await ledger.recall(c.idempotencyKey, callFingerprint(c.endpointId, c.input), now)) ? c.quotedMicros : 0;
  return n;
}

/** Sum of the quotes of a plan, in micros. */
export function planTotal(calls: PlannedCall[]): number {
  return calls.reduce((n, c) => n + c.quotedMicros, 0);
}

export interface RunOptions {
  triggers: Trigger[];
  state: SignalState;
  looot: LoootRunner;
  prices: PriceMap;
  /** Endpoints whose live price could not be read. Calls to them are skipped. */
  unpriced?: string[];
  capMicros: number;
  /** Period budget, reservations and stored results. Left out in demo mode and in tests that do not need it. */
  ledger?: Ledger;
  now: Date;
}

const cleanError = (e: unknown) => (e instanceof LoootError ? `${e.code ?? e.status}: ${e.message}` : (e as Error).message);

function costOf(run: LoootRun, quoted: number): number {
  if (run.actualCost !== undefined && run.actualCost !== null) return toMicros(run.actualCost);
  return run.status === "completed" ? quoted : 0;
}

/**
 * Runs every enabled trigger once. Checks the per-run cap before each call. A call still in progress when
 * waiting stops is recorded as pending and read again (free) on the next run. Returns the new state and the run record.
 */
export async function runTriggers(opts: RunOptions): Promise<{ state: SignalState; run: RunRecord }> {
  const { looot, now } = opts;
  const startedAt = now.toISOString();
  const plan = planCalls(opts.triggers, opts.prices, now);
  const searches = plan.filter((c) => !c.followUp);
  const previousKeys = new Set(opts.state.runs.flatMap((r) => r.calls.filter((c) => c.status === "completed").map((c) => c.idempotencyKey)));
  let signals = opts.state.signals;
  const pending = { ...opts.state.pending };
  const calls: CallRecord[] = [];
  let spent = 0;
  let newSignals = 0;
  const runId = `run-${hash(startedAt + plan.length)}`;

  const ingest = (c: PlannedCall, run: LoootRun, record: CallRecord) => {
    const raw = parseSource(c.source, run.result, now, c.trigger.keywords);
    const oldest = now.getTime() - c.trigger.maxAgeDays * 86_400_000;
    const incoming: Signal[] = raw
      .filter((r) => !r.occurredAt || new Date(r.occurredAt).getTime() >= oldest)
      .map((r) => ({ ...r, id: signalId(c.trigger.type, r), triggerId: c.trigger.id, triggerName: c.trigger.name, alsoTriggers: [], type: c.trigger.type, source: c.source, endpointId: c.endpointId, firstSeenAt: startedAt, runId }));
    const merged = mergeSignals(signals, incoming);
    signals = merged.all;
    record.found = raw.length;
    record.fresh = merged.fresh.length;
    newSignals += merged.fresh.length;
  };

  /**
   * One paid call. Order: a call already in progress is read again for free; a stored result answers a repeat with no
   * call; then the live price, the per-run cap, an atomic reservation against the period budget, and only then the call.
   * The reservation becomes the real cost when the call ends and goes back when looot answers with an error. A call
   * still in progress keeps it. Every outcome is written to `record`; nothing here throws.
   */
  const perform = async (c: { triggerId: string; source: SourceId; endpointId: string; input: Record<string, unknown>; quotedMicros: number; idempotencyKey: string }, record: CallRecord, onCompleted: (run: LoootRun) => void) => {
    const ledger = opts.ledger;
    const key = c.idempotencyKey;
    const fp = callFingerprint(c.endpointId, c.input);
    let reserved = false;
    try {
      const waiting = pending[key];
      if (!waiting) {
        const stored = await ledger?.recall(key, fp, now);
        if (stored) {
          record.runId = stored.runId;
          record.costMicros = 0;
          onCompleted(stored);
          return;
        }
        if (opts.unpriced?.includes(c.endpointId)) {
          record.status = "skipped_price";
          record.error = "The live price could not be read, so the call was not made.";
          return;
        }
        if (spent + c.quotedMicros > opts.capMicros) {
          record.status = "skipped_cap";
          record.error = "The run cap would be exceeded.";
          return;
        }
        if (ledger) {
          const held = await ledger.reserve(key, c.quotedMicros, now, fp);
          if (!held.ok) {
            record.status = "skipped_budget";
            record.error = held.message;
            return;
          }
          reserved = !held.shared;
        }
      }
      const replay = previousKeys.has(key);
      const run = waiting ? await looot.getRun(waiting.runId) : await looot.runAndWait(c.endpointId, c.input, key);
      record.runId = run.runId;
      if (!TERMINAL_STATUSES.has(run.status)) {
        // Still running at looot: the reservation stays until the run ends. It is never recorded failed at zero.
        record.status = "pending";
        pending[key] = { triggerId: c.triggerId, source: c.source, endpointId: c.endpointId, runId: run.runId, quotedMicros: c.quotedMicros };
        await ledger?.attach(key, run.runId);
        spent += waiting ? 0 : c.quotedMicros;
        return;
      }
      delete pending[key];
      if (run.status !== "completed") {
        record.status = "failed";
        record.error = run.error ? `${run.error.code ?? run.status}: ${run.error.message ?? ""}`.trim() : run.status;
        record.costMicros = replay ? 0 : costOf(run, 0);
        spent += record.costMicros;
        await ledger?.settle(key, fp, record.costMicros, now);
        return;
      }
      record.costMicros = replay || waiting ? 0 : costOf(run, c.quotedMicros);
      spent += record.costMicros;
      await ledger?.settle(key, fp, waiting ? costOf(run, c.quotedMicros) : record.costMicros, now, run);
      onCompleted(run);
    } catch (e) {
      record.status = "failed";
      record.error = cleanError(e);
      // An HTTP answer from looot means the call did not run, so the reservation goes back. Anything else (a network
      // error) is unknown: the request may have been accepted, so the reservation stays until a replay or the hard expiry.
      if (reserved && e instanceof LoootError) await ledger?.release(key).catch(() => undefined);
    }
  };

  for (const c of searches) {
    const record: CallRecord = { triggerId: c.trigger.id, source: c.source, endpointId: c.endpointId, idempotencyKey: c.idempotencyKey, status: "completed", runId: null, costMicros: 0, quotedMicros: c.quotedMicros, found: 0, fresh: 0 };
    calls.push(record);
    await perform({ triggerId: c.trigger.id, source: c.source, endpointId: c.endpointId, input: c.input, quotedMicros: c.quotedMicros, idempotencyKey: c.idempotencyKey }, record, (run) => ingest(c, run, record));
  }

  // Per-company lookups run after every search, so a lookup can never use up the cap before a search has run.
  // Each call asks about one company, is checked against the cap by itself, and has its own idempotency key.
  for (const trigger of opts.triggers.filter((t) => t.enabled && t.enrich.length > 0)) {
    const source = sourceFor(trigger);
    for (const id of trigger.enrich) {
      const f = FOLLOW_UPS[id];
      const unit = opts.prices[f.endpointId] ?? f.fallbackMicros;
      const domains: string[] = [];
      for (const s of [...signals].sort((a, b) => (b.occurredAt ?? b.firstSeenAt).localeCompare(a.occurredAt ?? a.firstSeenAt))) {
        if (s.triggerId === trigger.id && s.domain && s[id] === undefined && !domains.includes(s.domain)) domains.push(s.domain);
        if (domains.length >= trigger.enrichLimit) break;
      }
      for (const domain of domains) {
        const input = f.inputFor(domain);
        const key = keyFor(f.endpointId, input, now, LOOKUP_REFRESH_MS);
        const record: CallRecord = { triggerId: trigger.id, source, followUp: id, domain, endpointId: f.endpointId, idempotencyKey: key, status: "completed", runId: null, costMicros: 0, quotedMicros: unit, found: 0, fresh: 0 };
        calls.push(record);
        await perform({ triggerId: trigger.id, source, endpointId: f.endpointId, input, quotedMicros: unit, idempotencyKey: key }, record, (run) => {
          const founders = id === "founders" ? parseFounders(run.result) : [];
          const investors = id === "investors" ? parseInvestors(run.result) : [];
          record.found = id === "founders" ? founders.length : investors.length;
          signals = signals.map((s) => (s.triggerId === trigger.id && s.domain === domain && s[id] === undefined ? { ...s, ...(id === "founders" ? { founders } : { investors }) } : s));
        });
      }
    }
  }

  const run: RunRecord = { id: runId, startedAt, finishedAt: new Date().toISOString(), newSignals, spentMicros: spent, capMicros: opts.capMicros, calls };
  const state: SignalState = { version: 1, signals, pending, runs: [...opts.state.runs, run].slice(-50) };
  return { state, run };
}
