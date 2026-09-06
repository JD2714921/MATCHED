import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { D, sum } from "@/lib/math";
import { asMoney } from "@/lib/serialize";
import { realisedResult } from "@/lib/bets";
import { EmptyState, Money, Note, PageHeader, Panel, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  QUALIFYING_LOSS: "Qualifying",
  TOKEN_CONVERSION: "Conversion",
  COMMISSION: "Commission",
  ADJUSTMENT: "Adjustment",
};

export default async function ProfitPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/login?redirectTo=%2Fprofit");

  const entries = await prisma.ledgerEntry.findMany({
    where: { userId: user.id },
    include: { betPlan: { include: { operator: true } } },
    orderBy: { occurredAt: "desc" },
  });

  const completed = await prisma.betPlan.findMany({
    where: { userId: user.id, status: "COMPLETED" },
    include: { operator: true, legs: true },
    orderBy: { completedAt: "desc" },
  });

  const qualifying = sum(
    entries.filter((e) => e.kind === "QUALIFYING_LOSS").map((e) => new D(e.amount.toString())),
  );
  const conversion = sum(
    entries.filter((e) => e.kind === "TOKEN_CONVERSION").map((e) => new D(e.amount.toString())),
  );
  const total = sum(entries.map((e) => new D(e.amount.toString())));

  const plannedTotal = sum(
    completed.map((plan) => (plan.plannedNet ? new D(plan.plannedNet.toString()) : new D(0))),
  );
  const realisedTotal = sum(
    completed.map((plan) => (plan.realisedNet ? new D(plan.realisedNet.toString()) : new D(0))),
  );
  const variance = realisedTotal.minus(plannedTotal);

  return (
    <>
      <PageHeader
        title="Profit"
        lede="Computed from the stakes and prices you actually got, never from what was suggested."
      />

      <Panel className="mb-4">
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 px-6 py-5 md:grid-cols-4">
          <Stat
            label="Realised return"
            value={`£${asMoney(total)}`}
            hint={`${completed.length} completed position${completed.length === 1 ? "" : "s"}`}
            tone={total.isNegative() ? "negative" : "positive"}
          />
          <Stat
            label="Cost of qualifying"
            value={`£${asMoney(qualifying)}`}
            hint="what it cost to unlock the tokens"
            tone={qualifying.isNegative() ? "negative" : "default"}
          />
          <Stat
            label="From conversions"
            value={`£${asMoney(conversion)}`}
            hint="what the tokens converted to"
            tone="positive"
          />
          <Stat
            label="Against calculation"
            value={`${variance.isNegative() ? "−" : "+"}£${asMoney(variance.abs())}`}
            hint="realised minus what was calculated"
            tone={variance.isNegative() ? "negative" : "positive"}
          />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Completed positions" subtitle="Calculated against realised">
          {completed.length === 0 ? (
            <EmptyState
              title="Nothing completed yet"
              body="When a position has settled and you record what you actually got, it appears here."
            />
          ) : (
            <table className="data-table" data-testid="completed-table">
              <thead>
                <tr>
                  <th className="pl-5">Position</th>
                  <th className="num">Calculated</th>
                  <th className="num pr-5">Realised</th>
                </tr>
              </thead>
              <tbody>
                {completed.map((plan) => {
                  const result = realisedResult(plan.legs);
                  return (
                    <tr key={plan.id}>
                      <td className="pl-5">
                        <Link
                          href={`/bets/${plan.id}`}
                          className="text-[13px] text-ink underline-offset-2 hover:underline"
                        >
                          {plan.operator.name}
                        </Link>
                        <div className="text-[11px] text-ink-faint">{plan.selectionName}</div>
                      </td>
                      <td className="num">
                        {plan.plannedNet ? (
                          <Money value={asMoney(new D(plan.plannedNet.toString()))} signed />
                        ) : (
                          <span className="text-[12px] text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="num pr-5" data-testid="realised-cell">
                        {result.net ? (
                          <Money value={result.net.toFixed(2)} signed />
                        ) : (
                          <span className="text-[12px] text-ink-faint">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Ledger" subtitle="Every settled stage, most recent first">
          {entries.length === 0 ? (
            <EmptyState
              title="No entries yet"
              body="A ledger entry is written for each stage when a position is completed."
            />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="pl-5">Entry</th>
                  <th>Kind</th>
                  <th className="num pr-5">Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="pl-5">
                      <div className="text-[12px] text-ink">{entry.description}</div>
                      <div className="text-[11px] text-ink-faint">
                        {entry.occurredAt.toISOString().slice(0, 10)}
                      </div>
                    </td>
                    <td className="text-[12px] text-ink-muted">
                      {KIND_LABELS[entry.kind] ?? entry.kind}
                    </td>
                    <td className="num pr-5">
                      <Money value={asMoney(new D(entry.amount.toString()))} signed />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Note>
          A difference between calculated and realised is normal and worth watching. Lays fill at
          worse prices than the screen showed, commission varies by account, and a market can move
          between placing the two legs. A persistent gap in one direction usually means one of
          those is being underestimated.
        </Note>
      </div>
    </>
  );
}
