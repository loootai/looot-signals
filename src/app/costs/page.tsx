import type { Metadata } from "next";
import Link from "next/link";
import { BudgetForm } from "@/components/BudgetForm";
import { BudgetPanel } from "@/components/BudgetPanel";
import { requireAdminPage } from "@/lib/auth/guard";
import { IS_DEMO } from "@/lib/clock";
import { MICROS, usd } from "@/lib/money";
import { budgetStatus, capMicros } from "@/lib/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Costs and budget" };

export default async function CostsPage() {
  await requireAdminPage();
  const status = await budgetStatus();
  const reached = status.remainingMicros <= 0;
  return (
    <div className="grid max-w-4xl grid-cols-1 gap-6">
      <div>
        <h1 className="text-20 font-medium tracking-tight">Costs and budget</h1>
        <p className="mt-1 max-w-3xl text-mute">
          Every run is held to a cap per run ({usd(capMicros())}, set on the server), then to a daily and a monthly budget. Each call reserves its list price first and settles to the real cost. Per-run history is on the <Link href="/runs" className="text-link underline">Runs</Link> page.
        </p>
      </div>
      {reached && !IS_DEMO && (
        <p role="alert" className="rounded-panel border border-line bg-amber-soft p-3 text-amber">
          The budget is reached. Paid runs are refused until the period rolls over or the owner raises the budget below.
        </p>
      )}
      <BudgetPanel status={status} />
      <BudgetForm key={`${status.limits.dailyMicros}:${status.limits.monthlyMicros}`} dailyUsd={status.limits.dailyMicros / MICROS} monthlyUsd={status.limits.monthlyMicros / MICROS} disabled={IS_DEMO} />
    </div>
  );
}
