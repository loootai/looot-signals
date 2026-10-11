import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/auth/guard";
import { quoteNow } from "@/lib/service";

export const dynamic = "force-dynamic";

/** Free. The price of a run right now, per call. */
export async function GET(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  try {
    return NextResponse.json(await quoteNow(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
