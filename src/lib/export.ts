import { createHmac } from "node:crypto";
import { usd } from "./money";
import type { RunRecord, Signal } from "./types";

const COLUMNS = ["detected_at", "occurred_at", "type", "trigger", "company", "domain", "headline", "detail", "evidence_url", "source", "endpoint"] as const;

function cell(v: string | null | undefined): string {
  const s = v ?? "";
  // A leading = + - @ makes a spreadsheet read the cell as a formula. A quote in front stops that.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Signals as CSV, newest first. Cells that start like a formula get a leading quote. */
export function toCsv(signals: Signal[]): string {
  const rows = [...signals].sort((a, b) => (b.occurredAt ?? b.firstSeenAt).localeCompare(a.occurredAt ?? a.firstSeenAt));
  const lines = rows.map((s) => [s.firstSeenAt, s.occurredAt, s.type, s.triggerName, s.company, s.domain, s.headline, s.detail, s.evidenceUrl, s.source, s.endpointId].map((v) => cell(v)).join(","));
  return `${COLUMNS.join(",")}\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

/** The text of a run: what was new, what each call cost, what was skipped. */
export function toMarkdown(run: RunRecord, fresh: Signal[]): string {
  const out = [`# Signals, ${run.startedAt.slice(0, 10)}`, "", `${fresh.length} new. Spent ${usd(run.spentMicros)} of a ${usd(run.capMicros)} cap.`, ""];
  const byTrigger = new Map<string, Signal[]>();
  for (const s of fresh) byTrigger.set(s.triggerName, [...(byTrigger.get(s.triggerName) ?? []), s]);
  for (const [name, list] of byTrigger) {
    out.push(`## ${name} (${list.length})`, "");
    for (const s of list) out.push(`- ${s.company ?? s.domain ?? "Unknown company"}: ${s.headline}${s.occurredAt ? `, ${s.occurredAt.slice(0, 10)}` : ""}${s.evidenceUrl ? `. [Evidence](${s.evidenceUrl})` : ""}`);
    out.push("");
  }
  out.push("## Calls", "");
  for (const c of run.calls) out.push(`- ${c.triggerId} on ${c.endpointId}: ${c.status}, ${usd(c.costMicros)}, ${c.found} found, ${c.fresh} new${c.error ? `. ${c.error}` : ""}`);
  return `${out.join("\n")}\n`;
}

/** The body a webhook receives. */
export function webhookBody(signals: Signal[], now: Date): string {
  return JSON.stringify({ source: "looot-signals", generatedAt: now.toISOString(), count: signals.length, signals });
}

/** true for an https URL, or http on localhost. Anything else is refused. */
export function isAllowedWebhook(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname));
  } catch {
    return false;
  }
}

/** POSTs signals to a webhook. With a secret, adds X-Signals-Signature: sha256=<hmac of the body>. Returns the HTTP status. */
export async function sendWebhook(url: string, signals: Signal[], opts: { secret?: string; fetch?: typeof fetch; now?: Date } = {}): Promise<number> {
  if (!isAllowedWebhook(url)) throw new Error("The webhook must be an https URL (http only for localhost).");
  const body = webhookBody(signals, opts.now ?? new Date());
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.secret) headers["X-Signals-Signature"] = `sha256=${createHmac("sha256", opts.secret).update(body).digest("hex")}`;
  const res = await (opts.fetch ?? fetch)(url, { method: "POST", headers, body });
  return res.status;
}
