import { requireAdminRoute } from "@/lib/auth/guard";
import { now } from "@/lib/clock";
import { toCsv } from "@/lib/export";
import { filterSignals } from "@/lib/feed";
import { getState } from "@/lib/service";

export const dynamic = "force-dynamic";

/** The feed as CSV, with the same filters as the page: trigger, type, q, days. Never cached. */
export async function GET(req: Request) {
  const denied = await requireAdminRoute(req);
  if (denied) return denied;
  const p = new URL(req.url).searchParams;
  const rows = filterSignals((await getState()).signals, { trigger: p.get("trigger") || undefined, type: p.get("type") || undefined, q: p.get("q") || undefined, days: Number(p.get("days")) || 0 }, now());
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="signals-${now().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
