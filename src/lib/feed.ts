import { identityOf } from "./dedupe";
import type { Signal } from "./types";

export interface FeedFilter {
  trigger?: string;
  type?: string;
  q?: string;
  /** Only signals from the last N days. 0 or undefined means all. */
  days?: number;
}

/** The date a signal is filed under: when it happened, else when this app first saw it. */
export function filedAt(s: Signal): string {
  return s.occurredAt ?? s.firstSeenAt;
}

/** Applies the feed filters and sorts newest first. */
export function filterSignals(signals: Signal[], f: FeedFilter, now: Date): Signal[] {
  const since = f.days ? now.getTime() - f.days * 86_400_000 : null;
  const q = f.q?.trim().toLowerCase();
  return signals
    .filter((s) => (!f.trigger || s.triggerId === f.trigger || s.alsoTriggers.includes(f.trigger)) && (!f.type || s.type === f.type) && (since === null || new Date(filedAt(s)).getTime() >= since) && (!q || [s.company, s.domain, s.headline, s.detail].some((v) => v?.toLowerCase().includes(q))))
    .sort((a, b) => filedAt(b).localeCompare(filedAt(a)));
}

/** Label for a day heading: Today, Yesterday, or the date. */
export function dayLabel(iso: string, now: Date): string {
  const d = iso.slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (d === today) return "Today";
  if (d === yesterday) return "Yesterday";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric", timeZone: "UTC" });
}

/** Groups an already sorted list by day. */
export function groupByDay(signals: Signal[], now: Date): { label: string; day: string; items: Signal[] }[] {
  const groups: { label: string; day: string; items: Signal[] }[] = [];
  for (const s of signals) {
    const day = filedAt(s).slice(0, 10);
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(s);
    else groups.push({ label: dayLabel(filedAt(s), now), day, items: [s] });
  }
  return groups;
}

export interface CompanyGroup {
  identity: string;
  name: string;
  domain: string | null;
  signals: Signal[];
}

/** Companies that have signals of more than one type, strongest first. Shows who is moving on several fronts. */
export function multiSignalCompanies(signals: Signal[]): CompanyGroup[] {
  const by = new Map<string, CompanyGroup>();
  for (const s of signals) {
    if (!s.domain && !s.company) continue;
    const id = identityOf(s);
    const g = by.get(id) ?? { identity: id, name: s.company ?? s.domain ?? id, domain: s.domain, signals: [] };
    g.signals.push(s);
    by.set(id, g);
  }
  return [...by.values()].filter((g) => new Set(g.signals.map((s) => s.type)).size > 1).sort((a, b) => b.signals.length - a.signals.length || a.name.localeCompare(b.name));
}
