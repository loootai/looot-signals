"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface Toast {
  id: number;
  text: string;
  tone?: "default" | "error";
  action?: { label: string; run: () => void };
}

const Ctx = React.createContext<(t: Omit<Toast, "id">, ms?: number) => void>(() => {});

/** Shows a toast. An action (Undo) stays for five seconds. */
export function useToast() {
  return React.useContext(Ctx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const seq = React.useRef(0);
  const push = React.useCallback((t: Omit<Toast, "id">, ms = 5000) => {
    const id = ++seq.current;
    setToasts((list) => [...list.slice(-2), { ...t, id }]);
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), ms);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-3 md:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} className={cn("pop pointer-events-auto flex min-h-10 max-w-md items-center gap-3 rounded-panel border border-line bg-panel px-3 py-2 text-13 shadow-pop", t.tone === "error" && "border-high text-high")}>
            <span>{t.text}</span>
            {t.action ? (
              <button
                type="button"
                className="font-medium text-link underline-offset-2 hover:underline"
                onClick={() => {
                  t.action!.run();
                  setToasts((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
