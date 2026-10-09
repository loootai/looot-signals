import { NextResponse } from "next/server";
import { IS_DEMO, now } from "@/lib/clock";
import { sendWebhook } from "@/lib/export";
import { getState } from "@/lib/service";

export const dynamic = "force-dynamic";

/** Sends the signals of the last run to SIGNALS_WEBHOOK_URL. The URL is server config, never read from the request. */
export async function POST() {
  const state = await getState();
  const last = state.runs.at(-1);
  const fresh = last ? state.signals.filter((s) => s.runId === last.id) : [];
  if (IS_DEMO) return NextResponse.json({ sent: 0, status: 0, error: "Demo mode sends nothing." }, { status: 200 });
  const url = process.env.SIGNALS_WEBHOOK_URL;
  if (!url) return NextResponse.json({ error: "SIGNALS_WEBHOOK_URL is not set on the server." }, { status: 503 });
  if (fresh.length === 0) return NextResponse.json({ sent: 0, status: 0 });
  try {
    const status = await sendWebhook(url, fresh, { secret: process.env.SIGNALS_WEBHOOK_SECRET, now: now() });
    return NextResponse.json({ sent: fresh.length, status }, { status: status >= 400 ? 502 : 200 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
