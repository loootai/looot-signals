import type { LoootRun, LoootRunner } from "@/lib/looot";
import { rowsOf } from "@/lib/parse";
import { SOURCES } from "@/lib/sources";
import { fixtureBody } from "./fixtures";

const BY_ENDPOINT = Object.fromEntries(Object.values(SOURCES).map((s) => [s.endpointId, s]));

/**
 * A LoootRunner that answers from fixtures and never touches the network. Demo mode and tests use it.
 * It reports the list price a real call would have cost, so the demo screens show realistic numbers. Nothing is charged.
 */
export class FixtureRunner implements LoootRunner {
  readonly calls: { endpointId: string; input: Record<string, unknown>; idempotencyKey: string }[] = [];
  constructor(private readonly now: Date) {}

  async runAndWait(endpointId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<LoootRun> {
    this.calls.push({ endpointId, input, idempotencyKey });
    const result = fixtureBody(endpointId, input, this.now);
    const def = BY_ENDPOINT[endpointId];
    const micros = def ? (def.unit === "result" ? def.fallbackMicros * rowsOf(result).length : def.fallbackMicros) : 0;
    return { runId: `demo-${this.calls.length}`, status: "completed", result, actualCost: micros / 1e6 };
  }

  async getRun(runId: string): Promise<LoootRun> {
    return { runId, status: "completed", result: {}, actualCost: 0 };
  }
}
