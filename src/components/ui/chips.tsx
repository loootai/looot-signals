"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** An editable list of short values. Enter or a comma adds one, Backspace on an empty field removes the last. */
export function ChipInput({ id, value, onChange, placeholder, mono, label }: { id?: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; mono?: boolean; label: string }) {
  const [draft, setDraft] = React.useState("");
  const add = () => {
    const v = draft.trim().replace(/,$/, "");
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1 rounded-control border border-line-strong bg-panel p-1 focus-within:border-emerald hover:border-mute md:min-h-8">
      {value.map((v) => (
        <span key={v} className={cn("inline-flex h-6 items-center gap-0.5 rounded bg-hover pl-1.5 text-12", mono && "num")}>
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="flex size-6 items-center justify-center rounded text-mute hover:text-high">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        aria-label={label}
        value={draft}
        placeholder={value.length === 0 ? placeholder : "Add"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) onChange(value.slice(0, -1));
        }}
        className={cn("h-6 min-w-24 flex-1 bg-transparent px-1.5 text-13 outline-none", mono && "num text-12")}
      />
    </div>
  );
}
