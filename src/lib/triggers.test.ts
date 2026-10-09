import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTriggers, TriggerFileError } from "./triggers";

describe("parseTriggers", () => {
  it("reads the example file", () => {
    const t = parseTriggers(readFileSync("triggers.example.yaml", "utf8"));
    expect(t.map((x) => x.id)).toContain("gtm-engineer-hiring");
    expect(t.find((x) => x.id === "head-of-sales-feed")?.enabled).toBe(false);
    expect(t[0]).toMatchObject({ maxAgeDays: 14, limit: 25, enabled: true });
  });
  it("names the field that is wrong", () => {
    expect(() => parseTriggers("triggers:\n  - id: Bad Id\n    name: x\n    type: news\n    query: q")).toThrow(/id/);
    expect(() => parseTriggers("triggers: []")).toThrow(TriggerFileError);
    expect(() => parseTriggers("{{")).toThrow(/not valid YAML/);
  });
  it("rejects a source that cannot answer the type", () => {
    expect(() => parseTriggers("triggers:\n  - id: a\n    name: a\n    type: hiring\n    source: funding\n    titles: [x]")).toThrow(/cannot answer/);
  });
  it("rejects keywords on the index source and empty hiring triggers", () => {
    expect(() => parseTriggers("triggers:\n  - id: a\n    name: a\n    type: hiring\n    source: jobs_index\n    keywords: [clay]")).toThrow(/jobs_text/);
    expect(() => parseTriggers("triggers:\n  - id: a\n    name: a\n    type: hiring")).toThrow(/titles or keywords/);
  });
  it("rejects duplicate ids", () => {
    const one = "  - id: a\n    name: a\n    type: news\n    query: q\n";
    expect(() => parseTriggers(`triggers:\n${one}${one}`)).toThrow(/twice/);
  });
});
