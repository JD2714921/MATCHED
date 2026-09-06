import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { BetLeg } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { D } from "@/lib/math";
import { asMoney } from "@/lib/serialize";
import { PLAN_STAGES, legNet, realisedResult, stageIndex } from "@/lib/bets";
import { Badge, Money, Note, PageHeader, Panel } from "@/components/ui";
import { abandonPlan, completePlan, recordTokenReceived, settleStage } from "../actions";

export const dynamic = "force-dynamic";

export default async function BetPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent(`/bets/${id}`)}`);

  const plan = await prisma.betPlan.findFirst({
    where: { id, userId: user.id },
    include: { operator: true, promotion: true, legs: { orderBy: { createdAt: "asc" } } },
  });
  if (!plan) notFound();

  const qualifying = plan.legs.filter((leg) => leg.stage === "QUALIFYING");
  const conversion = plan.legs.filter((leg) => leg.stage === "CONVERSION");
  const result = realisedResult(plan.legs);
  const currentStage = stageIndex(plan.status);

  return (
    <>
      <PageHeader
        title={plan.operator.name}
        lede={`${plan.eventName} · ${plan.marketName} · ${plan.selectionName}`}
        right={
          <Link href="/bets" className="text-[12px] text-accent underline underline-offset-2">
            All positions
          </Link>
        }
      />

      <Panel className="mb-4">
        <ol className="flex flex-wrap gap-x-6 gap-y-2 px-5 py-4" data-testid="stage-track">
          {PLAN_STAGES.map((stage, index) => {
            const done = currentStage > index;
            const active = currentStage === index;
            return (
              <li key={stage.status} className="flex items-baseline gap-2">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    done ? "bg-positive" : active ? "bg-accent" : "bg-line-strong"
                  }`}
                />
                <span
                  className={`text-[12px] ${
                    active ? "font-medium text-ink" : done ? "text-ink-muted" : "text-ink-faint"
                  }`}
                >
                  {stage.label}
                </span>
              </li>
            );
          })}
        </ol>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <StageBlock
            title="Qualifying bet"
            stage="QUALIFYING"
            planId={plan.id}
            legs={qualifying}
            canSettle={plan.status === "PLANNED" || plan.status === "QUALIFYING_PLACED"}
          />

          {conversion.length > 0 ? (
            <StageBlock
              title="Token conversion"
              stage="CONVERSION"
              planId={plan.id}
              legs={conversion}
              canSettle={
                plan.status === "TOKEN_RECEIVED" || plan.status === "CONVERSION_PLACED"
              }
            />
          ) : (
            <Panel title="Token conversion">
              <div className="p-5">
                {plan.status === "TOKEN_RECEIVED" ? (
                  <>
                    <p className="mb-3 text-[12px] leading-relaxed text-ink-muted">
                      The token has arrived. Find a market to convert it against.
                    </p>
                    <Link
                      href={`/match?promotion=${plan.promotionId}&stage=CONVERSION`}
                      data-testid="find-conversion"
                      className="inline-block rounded-[4px] bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-ink"
                    >
                      Find a conversion
                    </Link>
                  </>
                ) : (
                  <p className="text-[12px] leading-relaxed text-ink-faint">
                    Once the qualifying bet has settled and the token has arrived, you can work out
                    the conversion here.
                  </p>
                )}
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Result">
            <div className="space-y-4 p-5">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                  Calculated when planned
                </div>
                <div className="mt-1">
                  {plan.plannedNet ? (
                    <Money value={asMoney(new D(plan.plannedNet.toString()))} size="lg" signed />
                  ) : (
                    <span className="text-[13px] text-ink-faint">—</span>
                  )}
                </div>
              </div>

              <div className="border-t border-line pt-4">
                <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                  Realised
                </div>
                <div className="mt-1" data-testid="realised-net">
                  {result.net ? (
                    <Money value={result.net.toFixed(2)} size="lg" signed />
                  ) : (
                    <span className="text-[13px] text-ink-faint">
                      {result.settledLegs} of {result.totalLegs} legs settled
                    </span>
                  )}
                </div>
                {result.usingSuggestions && result.settledLegs > 0 && (
                  <p className="mt-2 text-[11px] leading-relaxed text-caution">
                    Some legs are still using the suggested figures. Enter what you actually got for
                    a true result.
                  </p>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="Next">
            <div className="space-y-3 p-5">
              {plan.status === "QUALIFYING_SETTLED" && (
                <form action={recordTokenReceived}>
                  <input type="hidden" name="planId" value={plan.id} />
                  <button
                    type="submit"
                    data-testid="record-token"
                    className="w-full rounded-[4px] bg-accent px-3 py-2 text-[12px] font-medium text-white hover:bg-accent-ink"
                  >
                    Record the free bet arriving
                  </button>
                </form>
              )}

              {plan.status === "CONVERSION_PLACED" && result.complete && (
                <form action={completePlan}>
                  <input type="hidden" name="planId" value={plan.id} />
                  <button
                    type="submit"
                    data-testid="complete-plan"
                    className="w-full rounded-[4px] bg-accent px-3 py-2 text-[12px] font-medium text-white hover:bg-accent-ink"
                  >
                    Record completion
                  </button>
                </form>
              )}

              {plan.status === "COMPLETED" ? (
                <Note tone="accent">
                  Completed. The realised figure is on your{" "}
                  <Link href="/profit" className="underline underline-offset-2">
                    profit record
                  </Link>
                  .
                </Note>
              ) : plan.status === "ABANDONED" ? (
                <Note>This position was abandoned.</Note>
              ) : (
                <form action={abandonPlan}>
                  <input type="hidden" name="planId" value={plan.id} />
                  <button
                    type="submit"
                    className="w-full rounded-[4px] border border-line-strong px-3 py-2 text-[12px] text-ink-muted hover:bg-surface-sunken"
                  >
                    Abandon this position
                  </button>
                </form>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function StageBlock({
  title,
  stage,
  planId,
  legs,
  canSettle,
}: {
  title: string;
  stage: "QUALIFYING" | "CONVERSION";
  planId: string;
  legs: BetLeg[];
  canSettle: boolean;
}) {
  if (legs.length === 0) {
    return (
      <Panel title={title}>
        <div className="px-5 py-6 text-[12px] text-ink-faint">Nothing recorded for this stage.</div>
      </Panel>
    );
  }

  const settled = legs.every((leg) => leg.outcome !== "PENDING");
  const back = legs.find((leg) => leg.side === "BACK");
  const lay = legs.find((leg) => leg.side === "LAY");

  return (
    <Panel
      title={title}
      right={
        <Badge tone={settled ? "positive" : "neutral"}>{settled ? "Settled" : "Open"}</Badge>
      }
    >
      <table className="data-table">
        <thead>
          <tr>
            <th className="pl-5">Leg</th>
            <th className="num">Suggested</th>
            <th className="num">Actual</th>
            <th>Outcome</th>
            <th className="num pr-5">Result</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg) => {
            const net = legNet(leg);
            return (
              <tr key={leg.id}>
                <td className="pl-5">
                  <div className="text-[13px] text-ink">
                    {leg.side === "BACK" ? "Back" : "Lay"}
                  </div>
                  <div className="text-[11px] text-ink-faint">{leg.venue}</div>
                </td>
                <td className="num">
                  <span className="figure text-[12px] text-ink-faint">
                    £{leg.suggestedStake.toFixed(2)} @ {leg.suggestedOdds.toFixed(2)}
                  </span>
                </td>
                <td className="num">
                  {leg.actualStake && leg.actualOdds ? (
                    <span className="figure text-[12px] text-ink">
                      £{leg.actualStake.toFixed(2)} @ {leg.actualOdds.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-[12px] text-ink-faint">not recorded</span>
                  )}
                </td>
                <td>
                  <Badge
                    tone={
                      leg.outcome === "WON"
                        ? "positive"
                        : leg.outcome === "LOST"
                          ? "negative"
                          : "neutral"
                    }
                  >
                    {leg.outcome.toLowerCase()}
                  </Badge>
                </td>
                <td className="num pr-5">
                  {net ? (
                    <Money value={net.toFixed(2)} size="sm" signed />
                  ) : (
                    <span className="text-[12px] text-ink-faint">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {canSettle && !settled && (
        <form action={settleStage} className="border-t border-line p-5">
          <input type="hidden" name="planId" value={planId} />
          <input type="hidden" name="stage" value={stage} />

          <p className="mb-3 text-[12px] leading-relaxed text-ink-muted">
            Enter what you actually got. Lays fill worse than the screen showed more often than
            not, and the result should reflect that.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldPair
              label="Back bet"
              stakeName="back_stake"
              oddsName="back_odds"
              stakePlaceholder={back?.suggestedStake.toFixed(2) ?? "0.00"}
              oddsPlaceholder={back?.suggestedOdds.toFixed(2) ?? "0.00"}
              testPrefix="back"
            />
            <FieldPair
              label="Lay bet"
              stakeName="lay_stake"
              oddsName="lay_odds"
              stakePlaceholder={lay?.suggestedStake.toFixed(2) ?? "0.00"}
              oddsPlaceholder={lay?.suggestedOdds.toFixed(2) ?? "0.00"}
              testPrefix="lay"
            />
          </div>

          <fieldset className="mt-4">
            <legend className="text-[12px] font-medium text-ink">What happened?</legend>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                <input type="radio" name="selectionWon" value="no" defaultChecked />
                The selection did not win
              </label>
              <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                <input type="radio" name="selectionWon" value="yes" data-testid="selection-won" />
                The selection won
              </label>
            </div>
          </fieldset>

          <button
            type="submit"
            data-testid={`settle-${stage.toLowerCase()}`}
            className="mt-4 rounded-[4px] bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-ink"
          >
            Mark this stage complete
          </button>
        </form>
      )}
    </Panel>
  );
}

function FieldPair({
  label,
  stakeName,
  oddsName,
  stakePlaceholder,
  oddsPlaceholder,
  testPrefix,
}: {
  label: string;
  stakeName: string;
  oddsName: string;
  stakePlaceholder: string;
  oddsPlaceholder: string;
  testPrefix: string;
}) {
  return (
    <div className="rounded-[5px] border border-line bg-surface-sunken p-3">
      <div className="text-[11px] font-medium text-ink">{label}</div>
      <div className="mt-2 flex gap-2">
        <label className="flex-1">
          <span className="block text-[10px] uppercase tracking-[0.06em] text-ink-faint">
            Stake
          </span>
          <input
            name={stakeName}
            data-testid={`${testPrefix}-stake`}
            inputMode="decimal"
            placeholder={stakePlaceholder}
            className="figure mt-0.5 w-full rounded-[4px] border border-line-strong bg-surface px-2 py-1.5 text-[12px] outline-none focus:border-accent"
          />
        </label>
        <label className="flex-1">
          <span className="block text-[10px] uppercase tracking-[0.06em] text-ink-faint">Odds</span>
          <input
            name={oddsName}
            data-testid={`${testPrefix}-odds`}
            inputMode="decimal"
            placeholder={oddsPlaceholder}
            className="figure mt-0.5 w-full rounded-[4px] border border-line-strong bg-surface px-2 py-1.5 text-[12px] outline-none focus:border-accent"
          />
        </label>
      </div>
    </div>
  );
}
