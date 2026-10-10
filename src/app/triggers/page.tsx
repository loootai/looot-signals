import type { Metadata } from "next";
import { TriggersEditor } from "@/components/TriggersEditor";
import { Badge, Table, Td, Th } from "@/components/ui/misc";
import { usd, usdPrecise } from "@/lib/money";
import { getTriggers, getTriggersText, quoteNow } from "@/lib/service";
import { SOURCES, sourceFor } from "@/lib/sources";

export const metadata: Metadata = { title: "Triggers" };
export const dynamic = "force-dynamic";

export default async function TriggersPage() {
  const triggers = getTriggers();
  const quote = await quoteNow();
  const perTrigger = new Map<string, { calls: number; micros: number }>();
  for (const c of quote.calls) {
    const cur = perTrigger.get(c.triggerId) ?? { calls: 0, micros: 0 };
    perTrigger.set(c.triggerId, { calls: cur.calls + 1, micros: cur.micros + c.quotedMicros });
  }
  return (
    <div className="max-w-4xl">
      <h1 className="text-20 font-medium tracking-tight">Triggers</h1>
      <p className="mt-1 text-13 text-mute">Each trigger is one or more looot calls. The price of a run is shown here and again before it starts.</p>

      <div className="mt-4 overflow-x-auto rounded-panel border border-line bg-panel">
        <Table>
          <thead>
            <tr>
              <Th>Trigger</Th>
              <Th>Source</Th>
              <Th className="text-right">Calls</Th>
              <Th className="text-right">At most</Th>
            </tr>
          </thead>
          <tbody>
            {triggers.map((t) => {
              const def = SOURCES[sourceFor(t)];
              const q = perTrigger.get(t.id);
              return (
                <tr key={t.id} className={t.enabled ? "" : "opacity-60"}>
                  <Td>
                    <span className="font-medium">{t.name}</span> {t.enabled ? null : <Badge>Off</Badge>}
                    <span className="block text-12 text-mute">{t.type}, last {t.maxAgeDays} days, up to {t.limit} rows</span>
                  </Td>
                  <Td>
                    {def.label}
                    <span className="num block text-12 text-mute">{def.endpointId}</span>
                  </Td>
                  <Td className="num text-right">{q?.calls ?? 0}</Td>
                  <Td className="num text-right">{q ? usdPrecise(q.micros) : "$0.00"}</Td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <Td className="font-medium">Total per run</Td>
              <Td colSpan={2} className="text-12 text-mute">
                {quote.prices.source === "catalog" ? "Live prices from the looot catalog." : `List prices dated ${quote.prices.pricesAsOf.slice(0, 10)}.`} Cap {usd(quote.capMicros)}.
              </Td>
              <Td className="num text-right font-medium">{usdPrecise(quote.totalMicros)}</Td>
            </tr>
          </tfoot>
        </Table>
      </div>

      <div className="mt-6">
        <TriggersEditor initial={getTriggersText()} />
      </div>
    </div>
  );
}
