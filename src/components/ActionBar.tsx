"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Play, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { usdPrecise, usd } from "@/lib/money";

interface QuoteLine {
  triggerId: string;
  triggerName: string;
  endpointId: string;
  label: string;
  quotedMicros: number;
}
interface QuoteBody {
  calls: QuoteLine[];
  totalMicros: number;
  capMicros: number;
  prices: { pricesAsOf: string; source: string; unread: string[] };
}

/** Run now, export and webhook. Run now shows the quote first and sends the amount the user confirmed. */
export function ActionBar({ demo, exportHref, webhookReady }: { demo: boolean; exportHref: string; webhookReady: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const dialog = React.useRef<HTMLDialogElement>(null);
  const [quote, setQuote] = React.useState<QuoteBody | null>(null);
  const [busy, setBusy] = React.useState(false);

  const open = async () => {
    setQuote(null);
    dialog.current?.showModal();
    const res = await fetch("/api/quote");
    if (res.ok) setQuote((await res.json()) as QuoteBody);
    else {
      dialog.current?.close();
      toast({ text: "Could not read the prices.", tone: "error" });
    }
  };

  const confirm = async () => {
    if (!quote) return;
    setBusy(true);
    const res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmedMaxMicros: quote.totalMicros }) });
    const body = (await res.json()) as { run?: { newSignals: number; spentMicros: number }; error?: string };
    setBusy(false);
    dialog.current?.close();
    if (res.ok && body.run) {
      toast({ text: `${body.run.newSignals} new signals. Spent ${usd(body.run.spentMicros)}.` });
      router.refresh();
    } else toast({ text: body.error ?? "The run failed.", tone: "error" });
  };

  const sendWebhook = async () => {
    const res = await fetch("/api/webhook", { method: "POST" });
    const body = (await res.json()) as { sent?: number; status?: number; error?: string };
    toast(res.ok ? { text: body.sent ? `Sent ${body.sent} signals. The webhook answered ${body.status}.` : (body.error ?? "Nothing new to send.") } : { text: body.error ?? "The webhook failed.", tone: "error" });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="secondary">
        <a href={exportHref} download>
          <Download /> Export CSV
        </a>
      </Button>
      <Button variant="secondary" onClick={sendWebhook} disabled={!webhookReady} title={webhookReady ? "Sends the signals from the last run" : "Set SIGNALS_WEBHOOK_URL on the server"}>
        <Send /> Webhook
      </Button>
      <Button variant="primary" onClick={open}>
        <Play /> Run triggers
      </Button>

      <dialog ref={dialog} className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-panel border border-line bg-panel p-0 text-ink shadow-pop backdrop:bg-black/40">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-14 font-medium">Price of this run</h2>
          <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="flex size-8 items-center justify-center rounded-control text-mute hover:bg-hover">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[60dvh] overflow-auto px-4 py-3">
          {!quote ? (
            <p className="text-13 text-mute">Reading prices from the looot catalog.</p>
          ) : (
            <>
              <ul className="divide-y divide-line text-13">
                {quote.calls.map((c, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-medium">{c.triggerName}</span>
                      <span className="num block truncate text-12 text-mute">
                        {c.endpointId}: {c.label}
                      </span>
                    </span>
                    <span className="num shrink-0">{usdPrecise(c.quotedMicros)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-12 text-mute">
                Result-priced calls are quoted at their row limit, so the real charge is usually lower. {quote.prices.source === "catalog" ? "Live prices." : `Catalog unreachable, list prices dated ${quote.prices.pricesAsOf.slice(0, 10)}.`} Cap {usd(quote.capMicros)}. A failed call costs nothing.
                {demo ? " Demo mode: no call is made and nothing is charged." : ""}
              </p>
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="num text-14 font-medium">{quote ? `At most ${usdPrecise(quote.totalMicros)}` : ""}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} disabled={!quote || busy || quote.calls.length === 0}>
              {busy ? "Running" : "Run triggers"}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
