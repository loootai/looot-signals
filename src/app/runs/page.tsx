import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/guard";
import { Badge, Table, Td, Th } from "@/components/ui/misc";
import { usd } from "@/lib/money";
import { getState } from "@/lib/service";
import type { CallStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Runs and spend" };
export const dynamic = "force-dynamic";

const TONE: Record<CallStatus, "brand" | "high" | "amber" | "neutral"> = { completed: "brand", failed: "high", pending: "amber", skipped_budget: "amber", skipped_price: "amber", dry_run: "neutral" };

export default async function RunsPage() {
  await requireAdminPage();
  const state = await getState();
  const runs = [...state.runs].reverse();
  const month = new Date().toISOString().slice(0, 7);
  const monthSpend = state.runs.filter((r) => r.startedAt.startsWith(month)).reduce((n, r) => n + r.spentMicros, 0);
  return (
    <div className="max-w-4xl">
      <h1 className="text-20 font-medium tracking-tight">Runs and spend</h1>
      <p className="mt-1 text-13 text-mute">
        {runs.length} {runs.length === 1 ? "run" : "runs"} kept. {Object.keys(state.pending).length} calls pending. Spend this month: <span className="num">{usd(monthSpend)}</span>. A run still waiting on the provider is pending, never failed, and is read again for free on the next run.
      </p>
      {runs.length === 0 ? <p className="mt-6 text-13 text-mute">No run yet.</p> : null}
      {runs.map((r) => (
        <section key={r.id} className="mt-4 overflow-hidden rounded-panel border border-line bg-panel">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <span className="num text-13 font-medium">{r.startedAt.replace("T", " ").slice(0, 16)} UTC</span>
            <span className="text-12 text-mute">
              {r.newSignals} new, spent <span className="num">{usd(r.spentMicros)}</span> of a <span className="num">{usd(r.capMicros)}</span> cap
            </span>
          </header>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Trigger</Th>
                  <Th>Endpoint</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Found</Th>
                  <Th className="text-right">New</Th>
                  <Th className="text-right">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {r.calls.map((c, i) => (
                  <tr key={i}>
                    <Td>{c.triggerId}</Td>
                    <Td className="num text-12">{c.endpointId}</Td>
                    <Td>
                      <Badge tone={TONE[c.status]}>{c.status.replace("_", " ")}</Badge>
                      {c.error ? <span className="mt-0.5 block text-12 text-mute">{c.error}</span> : null}
                    </Td>
                    <Td className="num text-right">{c.found}</Td>
                    <Td className="num text-right">{c.fresh}</Td>
                    <Td className="num text-right">{usd(c.costMicros)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </section>
      ))}
    </div>
  );
}
