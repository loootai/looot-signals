import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppShell, type ShellSpend } from "@/components/AppShell";
import { ToastProvider } from "@/components/ui/toast";
import { IS_DEMO } from "@/lib/clock";
import { usd } from "@/lib/money";
import { getState } from "@/lib/service";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "looot-signals", template: "%s · looot-signals" },
  description: "Hiring, funding, news and leadership triggers as a dated feed with the evidence link for each signal. Built on looot.",
  icons: { icon: "/brand/looot-mark.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1512" },
  ],
};

// Sets the theme class before the first paint. ?theme=dark or ?theme=light overrides the saved choice for one view.
const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q||localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lastRun = (await getState()).runs.at(-1);
  const spend: ShellSpend | null = lastRun ? { title: "Last run", spent: usd(lastRun.spentMicros), cap: usd(lastRun.capMicros), ratio: lastRun.capMicros > 0 ? lastRun.spentMicros / lastRun.capMicros : 0, note: IS_DEMO ? "Sample data, nothing charged." : undefined } : null;
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <ToastProvider>
          <AppShell demo={IS_DEMO} spend={spend}>
            {children}
          </AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
