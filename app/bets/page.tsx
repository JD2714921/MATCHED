import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma, Prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { D } from "@/lib/math";
import { asMoney } from "@/lib/serialize";
import { realisedResult, PLAN_STAGES } from "@/lib/bets";
import { Badge, EmptyState, Money, PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

const STAGE_LABEL = new Map(PLAN_STAGES.map((stage) => [stage.status, stage.label]));

export default async function BetsPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/login?redirectTo=%2Fbets");

  const plans = await prisma.betPlan.findMany({
    where: { userId: user.id },
    include: { operator: true, legs: true },
    orderBy: { updatedAt: "desc" },
  });

  const open = plans.filter((p) => p.status !== "COMPLETED" && p.status !== "ABANDONED");
  const closed = plans.filter((p) => p.status === "COMPLETED" || p.status === "ABANDONED");

  return (
    <>
      <PageHeader
        title="My Bets"
        lede="Every position you have recorded, and what it actually came to."
      />

      <Panel title="Open" subtitle="Started but not settled" className="mb-4">
        {open.length === 0 ? (
          <EmptyState
            title="Nothing open"
            body="Work out a hedge in the Match Finder and record it, and it will appear here until both legs have settled."
          />
        ) : (
          <PlanTable plans={open} />
        )}
      </Panel>

      <Panel title="Closed">
        {closed.length === 0 ? (
          <EmptyState
            title="Nothing closed yet"
            body="Completed and abandoned positions are kept here."
          />
        ) : (
          <PlanTable plans={closed} />
        )}
      </Panel>
    </>
  );
}

type PlanWithDetail = Prisma.BetPlanGetPayload<{
  include: { operator: true; legs: true };
}>;

function PlanTable({ plans }: { plans: PlanWithDetail[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table" data-testid="bets-table">
        <thead>
          <tr>
            <th className="pl-5">Operator</th>
            <th>Selection</th>
            <th>Stage</th>
            <th className="num">Calculated</th>
            <th className="num pr-5">Realised</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => {
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
                  <div className="text-[11px] text-ink-faint">{plan.eventName}</div>
                </td>
                <td className="text-[12px] text-ink-muted">{plan.selectionName}</td>
                <td>
                  <Badge tone={plan.status === "COMPLETED" ? "positive" : "accent"}>
                    {STAGE_LABEL.get(plan.status) ?? plan.status.toLowerCase()}
                  </Badge>
                </td>
                <td className="num">
                  {plan.plannedNet ? (
                    <Money value={asMoney(new D(plan.plannedNet.toString()))} signed />
                  ) : (
                    <span className="text-[12px] text-ink-faint">—</span>
                  )}
                </td>
                <td className="num pr-5">
                  {result.net ? (
                    <Money value={result.net.toFixed(2)} signed />
                  ) : (
                    <span className="text-[12px] text-ink-faint">
                      {result.settledLegs}/{result.totalLegs}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
