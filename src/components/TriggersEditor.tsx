"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** The trigger file as text. Save checks it on the server and shows the first problem. */
export function TriggersEditor({ initial }: { initial: string }) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    const res = await fetch("/api/triggers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const body = (await res.json()) as { saved?: number; error?: string };
    setBusy(false);
    if (res.ok) {
      setError(null);
      toast({ text: `Saved ${body.saved} triggers.` });
      router.refresh();
    } else setError(body.error ?? "Could not save.");
  };

  return (
    <div>
      <label htmlFor="triggers-yaml" className="text-12 font-medium">
        Trigger file (YAML)
      </label>
      <textarea
        id="triggers-yaml"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        className="num mt-1.5 h-[28rem] w-full resize-y rounded-control border border-line-strong bg-panel p-3 text-12 leading-5 text-ink hover:border-mute focus-visible:border-emerald focus-visible:outline-offset-0 aria-[invalid=true]:border-high"
      />
      {error ? (
        <p role="alert" className="mt-1.5 text-12 text-high">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <Button variant="primary" onClick={save} disabled={busy || text === initial}>
          <Save /> Save triggers
        </Button>
        <span className="text-12 text-mute">Edits change the file the CLI reads too.</span>
      </div>
    </div>
  );
}
