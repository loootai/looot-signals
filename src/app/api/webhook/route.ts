import { NextResponse } from "next/server";
import { rateLimitSpend, requireAdminRoute } from "@/lib/auth/guard";
import { IS_DEMO, now } from "@/lib/clock";
import { sendWebhook } from "@/lib/export";
import { validateWebhookUrl } from "@/lib/netGuard";
import { getState } from "@/lib/service";

export const dynamic = "force-dynamic";

/**
 * Sends the signals of the last run to SIGNALS_WEBHOOK_URL. The URL is server config, never read from the
 * request, and is checked again here and after DNS (private, loopback and link-local targets are refused).
 * 10 sends in 10 minutes per session.
 */
export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const limited = await rateLimitSpend(req, "webhook");
  if (limited) return limited;
  if (IS_DEMO) return NextResponse.json({ sent: 0, status: 0, error: "Demo mode sends nothing." }, { status: 200 });
  const url = process.env.SIGNALS_WEBHOOK_URL;
  if (!url) return NextResponse.json({ error: "SIGNALS_WEBHOOK_URL is not set on the server." }, { status: 503 });
  const check = validateWebhookUrl(url);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  const state = await getState();
  const last = state.runs.at(-1);
  const fresh = last ? state.signals.filter((s) => s.runId === last.id) : [];
  if (fresh.length === 0) return NextResponse.json({ sent: 0, status: 0 });
  try {
    const status = await sendWebhook(url, fresh, { secret: process.env.SIGNALS_WEBHOOK_SECRET, now: now() });
    return NextResponse.json({ sent: fresh.length, status }, { status: status >= 300 ? 502 : 200 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
