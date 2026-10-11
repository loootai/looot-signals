import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/auth/guard";
import { getTriggersText, saveTriggersText } from "@/lib/service";
import { TriggerFileError } from "@/lib/triggers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  return NextResponse.json({ text: getTriggersText() }, { headers: { "Cache-Control": "no-store" } });
}

/** Body: { text }. Checks the YAML and saves it, or answers 422 with the first problem. */
export async function PUT(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  if (typeof body?.text !== "string") return NextResponse.json({ error: "text is required." }, { status: 400 });
  try {
    const triggers = saveTriggersText(body.text);
    return NextResponse.json({ saved: triggers.length });
  } catch (e) {
    if (e instanceof TriggerFileError) return NextResponse.json({ error: e.message }, { status: 422 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
