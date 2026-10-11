export const runtime = "nodejs";

/** Public. Says the process is up. Returns no data, no version, no config. */
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
