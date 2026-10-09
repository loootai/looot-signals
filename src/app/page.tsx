import { ArrowUpRight, Download } from "lucide-react";
import { ActionBar } from "@/components/ActionBar";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { IS_DEMO, now } from "@/lib/clock";
import { filterSignals, groupByDay, multiSignalCompanies } from "@/lib/feed";
import { hostLabel, isSafeLink } from "@/lib/format";
import { usd } from "@/lib/money";
import { getState, getTriggers } from "@/lib/service";
import type { Signal, TriggerType } from "@/lib/types";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<TriggerType, string> = { hiring: "Hiring", funding: "Funding", news: "News", leadership: "Leadership" };
const TYPE_TONE: Record<TriggerType, "brand" | "amber" | "neutral" | "medium"> = { hiring: "brand", funding: "amber", news: "neutral", leadership: "medium" };

type Params = Promise<Record<string, string | undefined>>;

function Row({ s, fresh, triggerNames }: { s: Signal; fresh: boolean; triggerNames: Map<string, string> }) {
  const who = s.company ?? s.domain ?? "Company not named";
  return (
    <li className="flex gap-3 border-b border-line px-4 py-3 last:border-b-0 md:px-6">
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${fresh ? "bg-emerald" : "bg-transparent"}`} aria-label={fresh ? "New in the last run" : undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone={TYPE_TONE[s.type]}>{TYPE_LABEL[s.type]}</Badge>
          <span className="text-14 font-medium">{who}</span>
          {s.domain && s.company ? <span className="num text-12 text-mute">{s.domain}</span> : null}
        </div>
        <p className="mt-1 text-13">{s.headline}</p>
        {s.detail ? <p className="mt-0.5 text-12 text-mute">{s.detail}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-mute">
          {isSafeLink(s.evidenceUrl) ? (
            <a href={s.evidenceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-link underline-offset-2 hover:underline">
              Evidence on {hostLabel(s.evidenceUrl)}
              <ArrowUpRight className="size-3" />
            </a>
          ) : (
            <span>No evidence link</span>
          )}
          <span>{[s.triggerId, ...s.alsoTriggers].map((id) => triggerNames.get(id) ?? id).join(", ")}</span>
          <span className="num">{s.endpointId}</span>
          {!s.occurredAt ? <span>Date not given by the provider</span> : null}
        </div>
      </div>
    </li>
  );
}

export default async function FeedPage({ searchParams }: { searchParams: Params }) {
  const p = await searchParams;
  const [state, triggers] = [await getState(), getTriggers()];
  const t = now();
  const names = new Map(triggers.map((x) => [x.id, x.name]));
  const days = Number(p.days ?? "30") || 0;
  const filter = { trigger: p.trigger || undefined, type: p.type || undefined, q: p.q || undefined, days };
  const list = filterSignals(state.signals, filter, t);
  const groups = groupByDay(list, t);
  const lastRun = state.runs.at(-1);
  const multi = multiSignalCompanies(state.signals).slice(0, 6);
  const exportQuery = new URLSearchParams(Object.entries(filter).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString();

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <header className="flex flex-wrap items-end justify-between gap-3 px-4 pb-4 pt-6 md:px-6">
        <div>
          <h1 className="text-20 font-medium tracking-tight">Signal feed</h1>
          <p className="mt-1 text-13 text-mute">
            {state.signals.length} signals from {triggers.filter((x) => x.enabled).length} triggers.{" "}
            {lastRun ? `Last run ${lastRun.startedAt.slice(0, 10)}, ${lastRun.newSignals} new, ${usd(lastRun.spentMicros)} spent.` : "No run yet."}
          </p>
        </div>
        <ActionBar demo={IS_DEMO} exportHref={`/api/export${exportQuery ? `?${exportQuery}` : ""}`} webhookReady={Boolean(process.env.SIGNALS_WEBHOOK_URL) || IS_DEMO} />
      </header>

      {multi.length > 0 ? (
        <section aria-label="Companies with more than one kind of signal" className="mx-4 mb-4 rounded-panel border border-line bg-panel p-3 md:mx-6">
          <h2 className="text-12 font-medium text-mute">Moving on more than one front</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {multi.map((g) => (
              <li key={g.identity}>
                <a href={`/?q=${encodeURIComponent(g.domain ?? g.name)}`} className="inline-flex items-center gap-1.5 rounded-control border border-line px-2 py-1 text-12 hover:bg-hover">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-mute">{[...new Set(g.signals.map((s) => TYPE_LABEL[s.type].toLowerCase()))].join(", ")}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form method="get" className="flex flex-wrap items-center gap-2 px-4 pb-3 md:px-6">
        <Input name="q" defaultValue={p.q ?? ""} placeholder="Search company or headline" aria-label="Search" className="w-full sm:w-56" />
        <Select name="trigger" defaultValue={p.trigger ?? ""} aria-label="Trigger" className="w-full sm:w-52">
          <option value="">All triggers</option>
          {triggers.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
        <Select name="type" defaultValue={p.type ?? ""} aria-label="Type" className="w-full sm:w-36">
          <option value="">All types</option>
          {(Object.keys(TYPE_LABEL) as TriggerType[]).map((k) => (
            <option key={k} value={k}>
              {TYPE_LABEL[k]}
            </option>
          ))}
        </Select>
        <Select name="days" defaultValue={String(days)} aria-label="Window" className="w-full sm:w-36">
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="0">All time</option>
        </Select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        <span className="num ml-auto text-12 text-mute">{list.length} shown</span>
      </form>

      {groups.length === 0 ? (
        <div className="mx-4 rounded-panel border border-dashed border-line-strong p-8 text-center md:mx-6">
          <p className="text-14 font-medium">No signals match.</p>
          <p className="mt-1 text-13 text-mute">Widen the window, clear the filters, or run the triggers.</p>
        </div>
      ) : (
        <div className="px-0 md:px-6">
          {groups.map((g) => (
            <section key={g.day} className="mb-4 overflow-hidden border-y border-line bg-panel md:rounded-panel md:border">
              <h2 className="sticky top-0 border-b border-line bg-panel px-4 py-1.5 text-12 font-medium text-mute md:px-6">
                {g.label} <span className="num ml-1">{g.items.length}</span>
              </h2>
              <ul>
                {g.items.map((s) => (
                  <Row key={s.id} s={s} fresh={lastRun ? s.runId === lastRun.id : false} triggerNames={names} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="px-4 text-12 text-mute md:px-6">
        <Download className="mr-1 inline size-3" />
        Dates are the provider&apos;s. A green dot marks signals found in the last run. Signals without a date are filed under the day they were first seen.
      </p>
    </div>
  );
}
