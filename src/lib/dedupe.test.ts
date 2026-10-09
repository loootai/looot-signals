import { describe, expect, it } from "vitest";
import { canonicalUrl, mergeSignals, signalId } from "./dedupe";
import type { RawSignal, Signal } from "./types";

const raw: RawSignal = { company: "Acme", domain: "acme.io", headline: "Hiring: GTM Engineer", evidenceUrl: "https://www.linkedin.com/jobs/view/1?trackingId=x", occurredAt: null };
const sig = (over: Partial<Signal> = {}): Signal => ({ ...raw, id: signalId("hiring", raw), triggerId: "a", triggerName: "A", alsoTriggers: [], type: "hiring", source: "jobs_index", endpointId: "e", firstSeenAt: "2026-10-10T00:00:00Z", runId: "r", ...over });

describe("canonicalUrl", () => {
  it("drops tracking, fragments, www and a trailing slash", () => {
    expect(canonicalUrl("https://www.Example.com/a/?utm_source=x&id=2#top")).toBe("https://example.com/a?id=2");
  });
  it("drops the whole query of a linkedin job page", () => {
    expect(canonicalUrl("https://www.linkedin.com/jobs/view/1?trackingId=x&refId=y")).toBe("https://linkedin.com/jobs/view/1");
  });
});

describe("signalId", () => {
  it("is the same for the same company and evidence, whatever the tracking", () => {
    expect(signalId("hiring", raw)).toBe(signalId("hiring", { ...raw, evidenceUrl: "https://linkedin.com/jobs/view/1?trackingId=other" }));
  });
  it("differs by company, evidence and type", () => {
    expect(signalId("hiring", raw)).not.toBe(signalId("hiring", { ...raw, domain: "other.io" }));
    expect(signalId("hiring", raw)).not.toBe(signalId("hiring", { ...raw, evidenceUrl: "https://linkedin.com/jobs/view/2" }));
    expect(signalId("hiring", raw)).not.toBe(signalId("news", raw));
  });
});

describe("mergeSignals", () => {
  it("adds only signals it has not seen", () => {
    const first = mergeSignals([], [sig()]);
    expect(first.fresh).toHaveLength(1);
    const second = mergeSignals(first.all, [sig()]);
    expect(second.fresh).toHaveLength(0);
    expect(second.all).toHaveLength(1);
  });
  it("records a second trigger on the existing signal", () => {
    const merged = mergeSignals([sig()], [sig({ triggerId: "b" })]);
    expect(merged.fresh).toHaveLength(0);
    expect(merged.all[0].alsoTriggers).toEqual(["b"]);
  });
});
