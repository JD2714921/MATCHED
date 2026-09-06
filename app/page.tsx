import Link from "next/link";
import { D } from "@/lib/math";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { buildOpportunities, summarise, type OpportunityView } from "@/lib/opportunities";
import { asMoney } from "@/lib/serialize";
import { Badge, EmptyState, Money, Note, Panel, Stat } from "@/components/ui";
import { OpportunityCard } from "@/components/opportunity-card";

export const dynamic = "force-dynamic";

/**
 * Today.
 *
 * Answers one question at the top — is there anything worth doing right now —
 * and then four narrower ones, because "best" depends on whether the customer
 * is short of time, capital or nerve.
 */
export default async function TodayPage() {
  const user = await getCurrentUser().catch(() => null);

  const [exchangeBalance, bookmakerBalance] = user
    ? await Promise.all([
        prisma.bankrollAccount.aggregate({
          where: { userId: user.id, kind: "EXCHANGE" },
          _sum: { balance: true },
        }),
        prisma.bankrollAccount.aggregate({
          where: { userId: user.id, kind: "BOOKMAKER" },
          _sum: { balance: true },
        }),
      ])
    : [null, null];

  const availableCapital =
    exchangeBalance?._sum.balance !== null && exchangeBalance?._sum.balance !== undefined
      ? new D(exchangeBalance._sum.balance.toString()).plus(
          bookmakerBalance?._sum.balance?.toString() ?? "0",
        )
      : null;

  const opportunities = await buildOpportunities({
    userId: user?.id ?? null,
    availableCapital,
  });
  const summary = summarise(opportunities);

  const inProgress = user
    ? await prisma.betPlan.findMany({
        where: { userId: user.id, status: { notIn: ["COMPLETED", "ABANDONED"] } },
        include: { operator: true, legs: true },
        orderBy: { updatedAt: "desc" },
        take: 6,
      })
    : [];

  const completed = user
    ? await prisma.betPlan.aggregate({
        where: { userId: user.id, status: "COMPLETED" },
        _sum: { realisedNet: true },
        _count: true,
      })
    : null;

  const picks = choosePicks(opportunities);

  return (
    <>
      {!user && (
        <div className="mb-6">
          <Note tone="accent">
            You are browsing signed out.{" "}
            <Link href="/login" className="underline underline-offset-2">
              Sign in
            </Link>{" "}
            to record bets, track a bankroll and see your own returns.
          </Note>
        </div>
      )}

      <Panel className="mb-6">
        <div className="px-6 py-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
            Available now
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-4">
            <Stat
              label="Good opportunities"
              value={String(summary.goodOpportunityCount)}
              hint={`from ${opportunities.length} published offer${opportunities.length === 1 ? "" : "s"}`}
            />
            <Stat
              label="Calculated promotional value"
              value={`£${summary.calculatedPromotionalValue}`}
              hint="across every outcome, at indicative prices"
              tone="positive"
            />
            <Stat
              label="Capital required"
              value={`£${summary.capitalRequired}`}
              hint="held by the exchange if you did all of them"
            />
            <Stat
              label="Highest single liability"
              value={`£${summary.highestLiability}`}
              hint="the largest amount tied up on one bet"
            />
          </div>
        </div>
      </Panel>

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold text-ink">Where to start</h2>
        <Link href="/offers" className="text-[12px] text-accent underline underline-offset-2">
          All offers
        </Link>
      </div>

      {picks.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nothing is published yet"
            body="Published offers appear here once an administrator has verified how their terms were read. Nothing reaches this screen on a machine's say-so."
          />
        </Panel>
      ) : (
        <div className={`mb-7 grid gap-3 ${PICK_GRID[picks.length] ?? PICK_GRID[4]}`}>
          {picks.map((pick) => (
            <OpportunityCard
              key={`${pick.heading}-${pick.opportunity.promotionId}`}
              opportunity={pick.opportunity}
              heading={pick.heading}
              because={pick.because}
            />
          ))}
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-3">
        <Panel
          title="In progress"
          subtitle="Positions you have started but not finished"
          className="lg:col-span-2"
        >
          {inProgress.length === 0 ? (
            <EmptyState
              title="Nothing in progress"
              body="When you work out a hedge and record the first bet, it will appear here until both legs have settled."
            />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="pl-5">Offer</th>
                  <th>Selection</th>
                  <th>Stage</th>
                  <th className="num pr-5">Calculated</th>
                </tr>
              </thead>
              <tbody>
                {inProgress.map((plan) => (
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
                      <Badge tone="accent">{STAGE_LABELS[plan.status] ?? plan.status}</Badge>
                    </td>
                    <td className="num pr-5">
                      {plan.plannedNet ? (
                        <Money value={asMoney(new D(plan.plannedNet.toString()))} signed />
                      ) : (
                        <span className="text-[12px] text-ink-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Realised" subtitle="What has actually settled">
          <div className="px-5 py-5">
            <Stat
              label="Realised return"
              value={`£${completed?._sum.realisedNet ? asMoney(new D(completed._sum.realisedNet.toString())) : "0.00"}`}
              hint={`${completed?._count ?? 0} completed position${completed?._count === 1 ? "" : "s"}`}
              tone={
                completed?._sum.realisedNet && Number(completed._sum.realisedNet) < 0
                  ? "negative"
                  : "positive"
              }
            />
            <div className="mt-5 border-t border-line pt-4">
              <Note>
                Realised figures come from the prices and stakes you actually got, not from what
                was suggested. Lays fill worse than the screen showed more often than not.
              </Note>
            </div>
            <Link
              href="/profit"
              className="mt-3 inline-block text-[12px] text-accent underline underline-offset-2"
            >
              Full profit record
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}

const STAGE_LABELS: Record<string, string> = {
  PLANNED: "Planned",
  QUALIFYING_PLACED: "Qualifying placed",
  QUALIFYING_SETTLED: "Qualifying settled",
  TOKEN_RECEIVED: "Token received",
  CONVERSION_PLACED: "Conversion placed",
};

/**
 * Column counts written out, because Tailwind cannot see a class name that is
 * assembled at runtime. Sized to the number of picks so a short list does not
 * leave a dangling empty column.
 */
const PICK_GRID: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-2 xl:grid-cols-4",
};

interface Pick {
  heading: string;
  because: string;
  opportunity: OpportunityView;
}

/**
 * Four different questions, four different answers — and never the same
 * offer twice, so the row is four choices rather than one repeated.
 */
function choosePicks(opportunities: OpportunityView[]): Pick[] {
  const usable = opportunities.filter((o) => o.indicativeCalculation && o.score?.actionable);
  if (usable.length === 0) return [];

  const taken = new Set<string>();
  const picks: Pick[] = [];

  const take = (
    heading: string,
    because: (o: OpportunityView) => string,
    rank: (a: OpportunityView, b: OpportunityView) => number,
  ) => {
    const candidate = [...usable].filter((o) => !taken.has(o.promotionId)).sort(rank)[0];
    if (!candidate) return;
    taken.add(candidate.promotionId);
    picks.push({ heading, because: because(candidate), opportunity: candidate });
  };

  take(
    "Best overall",
    (o) => o.score?.headline ?? "",
    (a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0),
  );

  take(
    "Easiest",
    (o) =>
      o.accountStatus === "OPEN"
        ? "You already hold this account, and the terms were read cleanly."
        : "The terms were read cleanly, so there is little to check for yourself.",
    (a, b) =>
      b.termsConfidence - a.termsConfidence ||
      (a.accountStatus === "OPEN" ? -1 : 1) - (b.accountStatus === "OPEN" ? -1 : 1),
  );

  take(
    "Highest return",
    (o) => `Converts ${o.indicativeCalculation?.rating}% of the token's face value.`,
    (a, b) =>
      Number(b.indicativeCalculation?.guaranteedNet ?? 0) -
      Number(a.indicativeCalculation?.guaranteedNet ?? 0),
  );

  take(
    "Lowest liability",
    (o) => `Ties up the least at the exchange of anything available.`,
    (a, b) =>
      Number(a.indicativeCalculation?.liability ?? 0) -
      Number(b.indicativeCalculation?.liability ?? 0),
  );

  return picks;
}
