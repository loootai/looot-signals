import "server-only";
import { readFileSync, writeFileSync } from "node:fs";
import { FixtureRunner } from "@/demo/fixtureRunner";
import { IS_DEMO, now } from "./clock";
import { planCalls, planTotal, runTriggers, type PlannedCall } from "./engine";
import { loootFromEnv } from "./looot";
import { toMicros } from "./money";
import { fetchPrices, FALLBACK_PRICES, type PriceResult } from "./prices";
import { readState, statePath, triggersPath, writeState } from "./store";
import { parseTriggers } from "./triggers";
import { EMPTY_STATE, type RunRecord, type SignalState, type Trigger } from "./types";

const g = globalThis as unknown as { __signalsDemo?: { state: SignalState; triggersText: string } };

/** Default cap for one run, in dollars. SIGNALS_CAP_USD changes it. */
export function capMicros(): number {
  return toMicros(process.env.SIGNALS_CAP_USD ?? "1");
}

export function getTriggersText(): string {
  if (IS_DEMO && g.__signalsDemo) return g.__signalsDemo.triggersText;
  return readFileSync(triggersPath(), "utf8");
}

/** Saves the trigger text after checking it. Throws a readable error when it does not parse. */
export function saveTriggersText(text: string): Trigger[] {
  const triggers = parseTriggers(text);
  if (IS_DEMO) {
    void getState();
    g.__signalsDemo!.triggersText = text;
  } else writeFileSync(triggersPath(), text);
  return triggers;
}

export function getTriggers(): Trigger[] {
  return parseTriggers(getTriggersText());
}

/** The saved state. In demo mode the first read runs the sample triggers once on the fixtures. */
export async function getState(): Promise<SignalState> {
  if (!IS_DEMO) return readState(statePath());
  if (!g.__signalsDemo) {
    const text = readFileSync(triggersPath(), "utf8");
    const t = now();
    const { state } = await runTriggers({ triggers: parseTriggers(text), state: { ...EMPTY_STATE, signals: [], pending: {}, runs: [] }, looot: new FixtureRunner(t), prices: FALLBACK_PRICES, capMicros: capMicros(), now: t });
    g.__signalsDemo = { state, triggersText: text };
  }
  return g.__signalsDemo.state;
}

async function saveState(state: SignalState): Promise<void> {
  if (IS_DEMO) g.__signalsDemo = { state, triggersText: getTriggersText() };
  else writeState(statePath(), state);
}

export interface Quote {
  calls: (Pick<PlannedCall, "source" | "endpointId" | "label" | "quotedMicros"> & { triggerId: string; triggerName: string })[];
  totalMicros: number;
  capMicros: number;
  prices: Pick<PriceResult, "pricesAsOf" | "source" | "unread">;
}

/** What a run would cost right now, from live catalog prices. Free, no token. */
export async function quoteNow(): Promise<Quote> {
  const triggers = getTriggers();
  const priced = await fetchPrices(undefined, { demo: IS_DEMO });
  const plan = planCalls(triggers, priced.prices, now());
  return {
    calls: plan.map((c) => ({ triggerId: c.trigger.id, triggerName: c.trigger.name, source: c.source, endpointId: c.endpointId, label: c.label, quotedMicros: c.quotedMicros })),
    totalMicros: planTotal(plan),
    capMicros: capMicros(),
    prices: { pricesAsOf: priced.pricesAsOf, source: priced.source, unread: priced.unread },
  };
}

export type RunNowResult = { ok: true; run: RunRecord } | { ok: false; code: "blocked_price" | "no_token"; message: string };

/**
 * Runs every enabled trigger. Re-reads live prices first and refuses when the total is above the
 * amount the user confirmed on screen, so a price change between the quote and the click cannot overspend.
 */
export async function runNow(confirmedMaxMicros: number): Promise<RunNowResult> {
  const triggers = getTriggers();
  const priced = await fetchPrices(undefined, { demo: IS_DEMO });
  const t = now();
  const total = planTotal(planCalls(triggers, priced.prices, t));
  if (total > confirmedMaxMicros) return { ok: false, code: "blocked_price", message: `The price is now ${total} micro-dollars a run, above the ${confirmedMaxMicros} you confirmed. Nothing was called.` };
  const cap = Math.min(capMicros(), confirmedMaxMicros);
  let looot;
  if (IS_DEMO) looot = new FixtureRunner(t);
  else {
    try {
      looot = loootFromEnv();
    } catch {
      return { ok: false, code: "no_token", message: "LOOOT_TOKEN is not set on the server." };
    }
  }
  const { state, run } = await runTriggers({ triggers, state: await getState(), looot, prices: priced.prices, unpriced: priced.unread, capMicros: cap, now: t });
  await saveState(state);
  return { ok: true, run };
}
