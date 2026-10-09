import { mergeSignals, signalId } from "./dedupe";
import { LoootError, TERMINAL_STATUSES, type LoootRun, type LoootRunner } from "./looot";
import { toMicros } from "./money";
import { parseSource } from "./parse";
import { SOURCES, callsFor, sourceFor } from "./sources";
import type { PriceMap } from "./prices";
import type { CallRecord, RunRecord, Signal, SignalState, SourceId, Trigger } from "./types";
import { hash } from "./utils";

export interface PlannedCall {
  trigger: Trigger;
  source: SourceId;
  endpointId: string;
  label: string;
  input: Record<string, unknown>;
  /** Most this call can cost at the given prices. Result-priced calls are quoted at `limit` rows. */
  quotedMicros: number;
  /** Same input, same day, same key: looot replays the stored run and never charges twice. */
  idempotencyKey: string;
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Every call a run would make, with its quote. Makes no request. */
export function planCalls(triggers: Trigger[], prices: PriceMap, now: Date): PlannedCall[] {
  return triggers
    .filter((t) => t.enabled)
    .flatMap((trigger) => {
      const source = sourceFor(trigger);
      const def = SOURCES[source];
      return callsFor(trigger, now).map(({ label, input }) => {
        const unit = prices[def.endpointId] ?? def.fallbackMicros;
        const rows = typeof input.limit === "number" ? input.limit : 1;
        return {
          trigger,
          source,
          endpointId: def.endpointId,
          label,
          input,
          quotedMicros: def.unit === "result" ? unit * rows : unit,
          idempotencyKey: `looot-signals:${trigger.id}:${def.endpointId}:${hash(JSON.stringify(input))}:${dayKey(now)}`,
        };
      });
    });
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

  for (const c of plan) {
    const record: CallRecord = { triggerId: c.trigger.id, source: c.source, endpointId: c.endpointId, idempotencyKey: c.idempotencyKey, status: "completed", runId: null, costMicros: 0, quotedMicros: c.quotedMicros, found: 0, fresh: 0 };
    calls.push(record);
    try {
      const waiting = pending[c.idempotencyKey];
      if (!waiting && opts.unpriced?.includes(c.endpointId)) {
        record.status = "skipped_price";
        record.error = "The live price could not be read, so the call was not made.";
        continue;
      }
      if (!waiting && spent + c.quotedMicros > opts.capMicros) {
        record.status = "skipped_budget";
        record.error = "The run cap would be exceeded.";
        continue;
      }
      const replay = previousKeys.has(c.idempotencyKey);
      const run = waiting ? await looot.getRun(waiting.runId) : await looot.runAndWait(c.endpointId, c.input, c.idempotencyKey);
      record.runId = run.runId;
      if (!TERMINAL_STATUSES.has(run.status)) {
        record.status = "pending";
        pending[c.idempotencyKey] = { triggerId: c.trigger.id, source: c.source, endpointId: c.endpointId, runId: run.runId, quotedMicros: c.quotedMicros };
        spent += waiting ? 0 : c.quotedMicros;
        continue;
      }
      delete pending[c.idempotencyKey];
      if (run.status !== "completed") {
        record.status = "failed";
        record.error = run.error ? `${run.error.code ?? run.status}: ${run.error.message ?? ""}`.trim() : run.status;
        record.costMicros = replay ? 0 : costOf(run, 0);
        spent += record.costMicros;
        continue;
      }
      record.costMicros = replay || waiting ? 0 : costOf(run, c.quotedMicros);
      spent += record.costMicros;
      ingest(c, run, record);
    } catch (e) {
      record.status = "failed";
      record.error = cleanError(e);
    }
  }

  const run: RunRecord = { id: runId, startedAt, finishedAt: new Date().toISOString(), newSignals, spentMicros: spent, capMicros: opts.capMicros, calls };
  const state: SignalState = { version: 1, signals, pending, runs: [...opts.state.runs, run].slice(-50) };
  return { state, run };
}
