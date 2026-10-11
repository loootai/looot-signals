// Runs a trigger file once and writes the new signals. No UI, no database, no sign-in.
//   npm run signals -- --triggers triggers.yaml --out signals-out [--cap 1] [--dry-run] [--webhook https://...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { FixtureRunner } from "@/demo/fixtureRunner";
import { planCalls, planTotal, runTriggers } from "@/lib/engine";
import { sendWebhook, toCsv, toMarkdown } from "@/lib/export";
import { LoootError, loootFromEnv } from "@/lib/looot";
import { toMicros, usd, usdPrecise } from "@/lib/money";
import { FALLBACK_PRICES, fetchPrices } from "@/lib/prices";
import { PRICES_AS_OF } from "@/lib/sources";
import { readState, writeState } from "@/lib/store";
import { parseTriggers, TriggerFileError } from "@/lib/triggers";

const HELP = `Usage: npm run signals -- --triggers <file> [options]

  --triggers <file>  Trigger file (YAML). Default: triggers.yaml, else triggers.example.yaml
  --out <dir>        Where new signals are written. Default: signals-out
  --state <file>     What was seen before. Default: data/state.json
  --cap <usd>        Most one run may spend. Default: 1.00
  --format <list>    json,csv,md (comma separated). Default: all three
  --webhook <url>    POST the new signals here. SIGNALS_WEBHOOK_URL works too. Secret: SIGNALS_WEBHOOK_SECRET
  --dry-run          Print the calls and the list-price cost. Makes no call and writes nothing.
  --demo             Use bundled sample answers. No token, no network.

Needs LOOOT_TOKEN in the environment, except with --dry-run or --demo.`;

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs({ options: { triggers: { type: "string" }, out: { type: "string", default: "signals-out" }, state: { type: "string", default: "data/state.json" }, cap: { type: "string", default: "1" }, format: { type: "string", default: "json,csv,md" }, webhook: { type: "string" }, "dry-run": { type: "boolean", default: false }, demo: { type: "boolean", default: false }, help: { type: "boolean", default: false } } }).values;
  } catch (e) {
    fail(`${(e as Error).message}\n\n${HELP}`, 2);
  }
  if (args.help) return console.log(HELP);

  const file = args.triggers ?? (existsSync("triggers.yaml") ? "triggers.yaml" : "triggers.example.yaml");
  let triggers;
  try {
    triggers = parseTriggers(readFileSync(resolve(file), "utf8"));
  } catch (e) {
    if (e instanceof TriggerFileError) fail(e.message, 2);
    fail(`Cannot read ${file}: ${(e as Error).message}`, 2);
  }
  const capMicros = toMicros(args.cap);
  if (capMicros <= 0) fail("--cap must be a positive dollar amount.", 2);
  const formats = new Set(String(args.format).split(",").map((f) => f.trim()));
  const now = new Date();

  const printPlan = (plan: ReturnType<typeof planCalls>, note: string) => {
    console.log(`Calls this run (${note}):`);
    for (const c of plan) console.log(`  ${c.trigger.id.padEnd(24)} ${c.endpointId.padEnd(42)} ${usdPrecise(c.quotedMicros).padStart(9)}  ${c.label}`);
    console.log(`Total at most ${usdPrecise(planTotal(plan))} for ${plan.reduce((n, c) => n + (c.followUp ? c.trigger.enrichLimit : 1), 0)} calls. Cap ${usd(capMicros)}.`);
  };

  if (args["dry-run"]) {
    printPlan(planCalls(triggers, FALLBACK_PRICES, now), `list prices dated ${PRICES_AS_OF}`);
    console.log("Dry run: no looot call was made and nothing was written.");
    return;
  }

  let looot;
  let prices = FALLBACK_PRICES;
  let unpriced: string[] = [];
  if (args.demo) looot = new FixtureRunner(now);
  else {
    try {
      looot = loootFromEnv();
    } catch (e) {
      if (e instanceof LoootError) fail("LOOOT_TOKEN is not set. Create an agent token at https://looot.ai/settings, or use --dry-run or --demo.", 2);
      throw e;
    }
    const priced = await fetchPrices();
    prices = priced.prices;
    unpriced = priced.unread;
  }
  const plan = planCalls(triggers, prices, now);
  printPlan(plan, args.demo ? "demo, no charge" : unpriced.length > 0 ? `live prices; unread: ${unpriced.join(", ")}` : "live prices from the looot catalog");

  const statePath = resolve(args.state);
  const before = readState(statePath);
  const { state, run } = await runTriggers({ triggers, state: before, looot, prices, unpriced, capMicros, now });
  // State first: it holds the pending run ids and the idempotency keys of the calls just made.
  writeState(statePath, state);

  const fresh = state.signals.filter((s) => s.runId === run.id);
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const written: string[] = [];
  const write = (ext: string, text: string) => {
    const file = join(outDir, `signals-${stamp}.${ext}`);
    writeFileSync(file, text);
    written.push(file);
  };
  if (formats.has("json")) write("json", `${JSON.stringify(fresh, null, 1)}\n`);
  if (formats.has("csv")) write("csv", toCsv(fresh));
  if (formats.has("md")) write("md", toMarkdown(run, fresh));

  const hook = args.webhook ?? process.env.SIGNALS_WEBHOOK_URL;
  if (hook && fresh.length > 0) {
    try {
      const status = await sendWebhook(hook, fresh, { secret: process.env.SIGNALS_WEBHOOK_SECRET });
      console.log(`Webhook answered HTTP ${status}.`);
    } catch (e) {
      console.error(`Webhook failed: ${(e as Error).message}`);
    }
  }

  console.log(`\n${fresh.length} new signals. Spent ${usd(run.spentMicros)} of ${usd(capMicros)}.`);
  for (const c of run.calls.filter((c) => c.status !== "completed")) console.log(`  ${c.triggerId}: ${c.status}${c.error ? `, ${c.error}` : ""}`);
  for (const w of written) console.log(`Wrote ${w}`);
  console.log(`State: ${statePath}`);
  if (run.calls.length > 0 && run.calls.every((c) => c.status === "failed")) fail("Every call failed. See the messages above.");
}

main().catch((e) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
