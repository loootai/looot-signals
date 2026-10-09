"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, ListChecks, Moon, Radar, Sun } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { ToastProvider } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Feed", icon: Radar },
  { href: "/triggers", label: "Triggers", icon: ListChecks },
  { href: "/runs", label: "Runs and spend", icon: History },
];

function setTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {}
}

/** App frame: a sidebar on desktop, a top bar with tabs on a phone. */
export function Shell({ demo, children }: { demo: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col md:flex-row">
        <aside className="shrink-0 border-b border-line bg-panel md:sticky md:top-0 md:h-dvh md:w-56 md:border-b-0 md:border-r">
          <div className="flex h-12 items-center justify-between gap-2 border-b border-line px-4 md:border-b">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/brand/looot-mark.svg" alt="looot" width={24} height={24} priority />
              <span className="text-13 font-medium tracking-tight">signals</span>
            </Link>
            <div className="flex items-center gap-2">
              {demo ? <Badge tone="amber">Demo data</Badge> : null}
              <button type="button" aria-label="Switch theme" onClick={() => setTheme(!document.documentElement.classList.contains("dark"))} className="flex size-8 items-center justify-center rounded-control text-mute hover:bg-hover hover:text-ink">
                <Sun className="size-4 dark:hidden" />
                <Moon className="hidden size-4 dark:block" />
              </button>
            </div>
          </div>
          <nav aria-label="Main" className="flex gap-px overflow-x-auto p-2 md:flex-col">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={cn("flex h-9 items-center gap-2 whitespace-nowrap rounded-control px-2.5 text-13 text-mute hover:bg-hover hover:text-ink md:h-8", active(n.href) && "bg-brand-soft font-medium text-link")}>
                <n.icon className="size-4" />
                {n.label}
              </Link>
            ))}
          </nav>
          <p className="hidden px-4 pt-4 text-12 text-mute md:block">An open-source alternative to paid signal feeds. Data from looot, one key, pay per call.</p>
        </aside>
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
