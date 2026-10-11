import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "./policy";

/** true when a real looot token is set or the state file exists. Server only. */
export function hasRealData(env: Env = process.env): boolean {
  if (env.LOOOT_TOKEN && env.LOOOT_TOKEN.trim() !== "") return true;
  return existsSync(resolve(/* turbopackIgnore: true */ env.SIGNALS_STATE || "data/state.json"));
}
