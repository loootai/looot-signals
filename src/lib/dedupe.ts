import { hash } from "./utils";
import type { RawSignal, Signal, TriggerType } from "./types";

/** URL without fragment, tracking parameters, and (for job pages) the whole query. Same page, same string. */
export function canonicalUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.hash = "";
    const keep = /linkedin\.com\/jobs/.test(u.href) ? [] : [...u.searchParams.keys()].filter((k) => !/^(utm_|trk|tracking|ref|fbclid|gclid|mc_)/i.test(k));
    const q = new URLSearchParams();
    for (const k of keep.sort()) q.set(k, u.searchParams.get(k) ?? "");
    const qs = q.toString();
    return `${u.protocol}//${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${qs ? `?${qs}` : ""}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Who the signal is about: the domain when there is one, else the company name, else the site that published it. */
export function identityOf(s: RawSignal): string {
  if (s.domain) return s.domain;
  if (s.company) return s.company.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const u = canonicalUrl(s.evidenceUrl);
  return u ? new URL(u).hostname : "unknown";
}

/** Stable id of a signal. The same company and the same evidence give the same id in any trigger and any run. */
export function signalId(type: TriggerType, s: RawSignal): string {
  const evidence = canonicalUrl(s.evidenceUrl) ?? s.headline.toLowerCase().replace(/\s+/g, " ");
  return hash(`${type}|${identityOf(s)}|${evidence}`);
}

/**
 * Adds raw signals to the known list. A signal already known is not added again; when another
 * trigger found it, that trigger is recorded on the existing one. Returns the new signals only.
 */
export function mergeSignals(known: Signal[], incoming: Signal[]): { all: Signal[]; fresh: Signal[] } {
  const byId = new Map(known.map((s) => [s.id, s]));
  const fresh: Signal[] = [];
  for (const s of incoming) {
    const have = byId.get(s.id);
    if (!have) {
      byId.set(s.id, s);
      fresh.push(s);
    } else if (have.triggerId !== s.triggerId && !have.alsoTriggers.includes(s.triggerId)) {
      byId.set(s.id, { ...have, alsoTriggers: [...have.alsoTriggers, s.triggerId] });
    }
  }
  return { all: [...byId.values()], fresh };
}
