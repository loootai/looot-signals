import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { LoootError } from "./looot";
import { EMPTY_STATE, type SignalState } from "./types";

/** Reads the state file, or an empty state when there is none. */
export function readState(path: string): SignalState {
  const p = resolve(/*turbopackIgnore: true*/ path);
  if (!existsSync(p)) return { ...EMPTY_STATE, signals: [], pending: {}, runs: [] };
  const parsed = JSON.parse(readFileSync(p, "utf8")) as SignalState;
  if (parsed.version !== 1) throw new LoootError(`Unknown state file version in ${path}`, 500, "bad_state");
  return parsed;
}

/** Writes the state file, creating its folder. */
export function writeState(path: string, state: SignalState): void {
  const p = resolve(/*turbopackIgnore: true*/ path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(state, null, 1)}\n`);
}

/** The trigger file the app reads: SIGNALS_TRIGGERS, else triggers.yaml, else triggers.example.yaml. */
export function triggersPath(env: Record<string, string | undefined> = process.env): string {
  if (env.SIGNALS_TRIGGERS) return resolve(/*turbopackIgnore: true*/ env.SIGNALS_TRIGGERS);
  return existsSync(resolve(/*turbopackIgnore: true*/ "triggers.yaml")) ? resolve(/*turbopackIgnore: true*/ "triggers.yaml") : resolve(/*turbopackIgnore: true*/ "triggers.example.yaml");
}

export function statePath(env: Record<string, string | undefined> = process.env): string {
  return resolve(/*turbopackIgnore: true*/ env.SIGNALS_STATE ?? "data/state.json");
}
