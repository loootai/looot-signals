import { createHmac } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { validateWebhookUrl, resolveSafe, type Lookup } from "./netGuard";
import { usd } from "./money";
import type { RunRecord, Signal } from "./types";

const COLUMNS = ["detected_at", "occurred_at", "type", "trigger", "company", "domain", "headline", "detail", "evidence_url", "source", "endpoint", "founders", "investors"] as const;

function cell(v: string | null | undefined): string {
  const s = v ?? "";
  // A leading = + - @ makes a spreadsheet read the cell as a formula. A quote in front stops that.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Signals as CSV, newest first. Cells that start like a formula get a leading quote. */
export function toCsv(signals: Signal[]): string {
  const rows = [...signals].sort((a, b) => (b.occurredAt ?? b.firstSeenAt).localeCompare(a.occurredAt ?? a.firstSeenAt));
  const lines = rows.map((s) => [s.firstSeenAt, s.occurredAt, s.type, s.triggerName, s.company, s.domain, s.headline, s.detail, s.evidenceUrl, s.source, s.endpointId, (s.founders ?? []).map((f) => (f.title ? `${f.name} (${f.title})` : f.name)).join("; "), (s.investors ?? []).join("; ")].map((v) => cell(v)).join(","));
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

/** true for an https URL on a public host. See validateWebhookUrl for the full list of refusals. */
export function isAllowedWebhook(url: string): boolean {
  return validateWebhookUrl(url).ok;
}

/** What the transport needs to make one pinned request. */
export interface WebhookTarget {
  url: string;
  hostname: string;
  address: string;
  family: number;
  port: number;
  path: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * The default transport. Connects to the address that was already checked, sends the real host name for
 * TLS and the Host header, and never follows a redirect. Resolves with the HTTP status.
 */
export function postPinned(t: WebhookTarget): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      { host: t.address, family: t.family, port: t.port, method: "POST", path: t.path, servername: isIP(t.hostname) ? undefined : t.hostname, headers: { ...t.headers, Host: new URL(t.url).host, "Content-Length": String(Buffer.byteLength(t.body)) }, timeout: 10_000 },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => req.destroy(new Error("The webhook timed out.")));
    req.on("error", reject);
    req.end(t.body);
  });
}

/**
 * POSTs signals to a webhook. Checks the URL, resolves the host and refuses a private answer, then
 * connects to the address it checked. A redirect is returned as its status and never followed.
 * With a secret, adds X-Signals-Signature: sha256=<hmac of the body>. Returns the HTTP status.
 */
export async function sendWebhook(url: string, signals: Signal[], opts: { secret?: string; now?: Date; lookup?: Lookup; post?: (t: WebhookTarget) => Promise<number> } = {}): Promise<number> {
  const check = validateWebhookUrl(url);
  if (!check.ok) throw new Error(check.error);
  const body = webhookBody(signals, opts.now ?? new Date());
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.secret) headers["X-Signals-Signature"] = `sha256=${createHmac("sha256", opts.secret).update(body).digest("hex")}`;
  const { address, family } = await resolveSafe(check.hostname, opts.lookup);
  const u = check.url;
  return (opts.post ?? postPinned)({ url: u.href, hostname: check.hostname, address, family, port: Number(u.port) || 443, path: `${u.pathname}${u.search}`, headers, body });
}
