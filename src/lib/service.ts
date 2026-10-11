import "server-only";
import { readFileSync, writeFileSync } from "node:fs";
import { FixtureRunner } from "@/demo/fixtureRunner";
import { Budget, type BudgetStatus } from "./budget";
import { IS_DEMO, now } from "./clock";
import { payableMicros, planCalls, planTotal, runTriggers, type PlannedCall } from "./engine";
import { loootFromEnv } from "./looot";
import { toMicros, usd } from "./money";
import { fetchPrices, FALLBACK_PRICES, type PriceResult } from "./prices";
import { readState, statePath, triggersPath, writeState } from "./store";
import { parseTriggers } from "./triggers";
import { EMPTY_STATE, type RunRecord, type SignalState, type Trigger } from "./types";

const g = globalThis as unknown as { __signalsDemo?: { state: SignalState; triggersText: string } };

/** Cap for one run, in dollars. Server config only (SIGNALS_CAP_USD, default 1). No request can change it. */
export function capMicros(): number {
  return toMicros(process.env.SIGNALS_CAP_USD ?? "1");
}

/** The period budget file. Demo mode only reads it, so a demo shows the owner's real numbers and writes nothing. */
export function getBudget(): Budget {
  return new Budget();
}

/** Used, reserved and remaining for today and this month. */
export async function budgetStatus(at: Date = new Date()): Promise<BudgetStatus> {
  return getBudget().status(at);
}

/** Owner only (the route checks the session and the CSRF token). Saves the daily and monthly budget in dollars. */
export async function setBudget(input: { dailyUsd: unknown; monthlyUsd: unknown }): Promise<BudgetStatus> {
  if (IS_DEMO) throw new Error("Demo mode has no budget to change.");
  const b = getBudget();
  await b.setLimits({ dailyMicros: toMicros(Number(input.dailyUsd)), monthlyMicros: toMicros(Number(input.monthlyUsd)) });
  return b.status();
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

export type RunNowResult = { ok: true; run: RunRecord } | { ok: false; code: "blocked_price" | "blocked_budget" | "no_token"; message: string };

/**
 * Runs every enabled trigger. Re-reads live prices first and refuses when the total is above the
 * amount the user confirmed on screen, so a price change between the quote and the click cannot overspend.
 * The confirmed amount is a price check only. It does not set the cap: the cap is the server's.
 * Check order: quote, cap per run, atomic reservation against the period budget (per call), then the call.
 */
export async function runNow(confirmedMaxMicros: number): Promise<RunNowResult> {
  const triggers = getTriggers();
  const priced = await fetchPrices(undefined, { demo: IS_DEMO });
  const t = now();
  const total = planTotal(planCalls(triggers, priced.prices, t));
  if (total > confirmedMaxMicros) return { ok: false, code: "blocked_price", message: `The price is now ${total} micro-dollars a run, above the ${confirmedMaxMicros} you confirmed. Nothing was called.` };
  const cap = capMicros();
  let looot;
  if (IS_DEMO) looot = new FixtureRunner(t);
  else {
    try {
      looot = loootFromEnv();
    } catch {
      return { ok: false, code: "no_token", message: "LOOOT_TOKEN is not set on the server." };
    }
  }
  // Runs that ended since last time settle first. Calls a stored result answers cost nothing, so they are not counted.
  const budget = IS_DEMO ? undefined : getBudget();
  if (budget) {
    await budget.reconcile(looot);
    const room = await budget.status(t);
    const payable = await payableMicros(planCalls(triggers, priced.prices, t), budget, t);
    if (payable > room.remainingMicros) return { ok: false, code: "blocked_budget", message: `The run needs up to ${usd(payable)}, above what is left of the budget (${usd(room.remainingMicros)}: ${usd(room.day.remainingMicros)} today, ${usd(room.month.remainingMicros)} this month). Raise the budget on the Costs page, or wait for the period to roll over. Nothing was called.` };
  }
  const { state, run } = await runTriggers({ triggers, state: await getState(), looot, prices: priced.prices, unpriced: priced.unread, capMicros: cap, ledger: budget, now: t });
  await saveState(state);
  return { ok: true, run };
}
