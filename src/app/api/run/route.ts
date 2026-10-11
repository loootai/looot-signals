import { NextResponse } from "next/server";
import { rateLimitSpend, requireAdminRoute } from "@/lib/auth/guard";
import { runNow } from "@/lib/service";

export const dynamic = "force-dynamic";

/**
 * Paid (not in demo mode). Body: { confirmedMaxMicros }. Refused when the live price is above that amount.
 * The spend cap comes from SIGNALS_CAP_USD on the server and the period budget from budget.json. The body sets neither:
 * confirmedMaxMicros only checks the price, and any cap or budget field in the body is ignored. 10 runs in 10 minutes per session.
 */
export async function POST(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const limited = await rateLimitSpend(req, "run");
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { confirmedMaxMicros?: unknown } | null;
  const max = body?.confirmedMaxMicros;
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) return NextResponse.json({ error: "confirmedMaxMicros is required: the amount the user saw on the quote." }, { status: 400 });
  try {
    const res = await runNow(max);
    if (!res.ok) return NextResponse.json({ error: res.message, code: res.code }, { status: res.code === "no_token" ? 503 : 409 });
    return NextResponse.json({ run: res.run });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
