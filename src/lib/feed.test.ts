import { describe, expect, it } from "vitest";
import { FixtureRunner } from "@/demo/fixtureRunner";
import { filterSignals, groupByDay, multiSignalCompanies } from "./feed";
import { runTriggers } from "./engine";
import { FALLBACK_PRICES } from "./prices";
import { readFileSync } from "node:fs";
import { parseTriggers } from "./triggers";
import { EMPTY_STATE, type Signal } from "./types";

const NOW = new Date("2026-10-10T09:00:00.000Z");
let all: Signal[] = [];
async function load() {
  if (all.length > 0) return all;
  const { state } = await runTriggers({ triggers: parseTriggers(readFileSync("triggers.example.yaml", "utf8")), state: { ...EMPTY_STATE, signals: [], pending: {}, runs: [] }, looot: new FixtureRunner(NOW), prices: FALLBACK_PRICES, capMicros: 1_000_000, now: NOW });
  all = state.signals;
  return all;
}

describe("feed", () => {
  it("filters by type, trigger, text and window, newest first", async () => {
    const s = await load();
    const hiring = filterSignals(s, { type: "hiring" }, NOW);
    expect(hiring.every((x) => x.type === "hiring")).toBe(true);
    expect(hiring[0].occurredAt! >= hiring.at(-1)!.occurredAt!).toBe(true);
    expect(filterSignals(s, { q: "kestrel" }, NOW).every((x) => /kestrel/i.test(`${x.company}${x.domain}${x.headline}`))).toBe(true);
    expect(filterSignals(s, { days: 3 }, NOW).every((x) => new Date(x.occurredAt!).getTime() >= NOW.getTime() - 3 * 86_400_000)).toBe(true);
    expect(filterSignals(s, { trigger: "recent-rounds" }, NOW).length).toBe(5);
  });
  it("groups by day with Today and Yesterday labels", async () => {
    const g = groupByDay(filterSignals(await load(), {}, NOW), NOW);
    expect(g.map((x) => x.label).slice(0, 2)).toEqual(["Yesterday", "Oct 8"]);
    expect(g.reduce((n, x) => n + x.items.length, 0)).toBe((await load()).length);
  });
  it("finds companies with signals of more than one type", async () => {
    const m = multiSignalCompanies(await load());
    expect(m.map((x) => x.domain)).toContain("kestrel.example");
    expect(m.every((x) => new Set(x.signals.map((s) => s.type)).size > 1)).toBe(true);
  });
});
