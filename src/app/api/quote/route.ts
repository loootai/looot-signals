import { NextResponse } from "next/server";
import { quoteNow } from "@/lib/service";

export const dynamic = "force-dynamic";

/** Free. The price of a run right now, per call. */
export async function GET() {
  try {
    return NextResponse.json(await quoteNow());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
