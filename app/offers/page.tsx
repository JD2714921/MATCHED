import Link from "next/link";
import { D } from "@/lib/math";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { buildOpportunities } from "@/lib/opportunities";
import {
  Badge,
  DelayBadge,
  EmptyState,
  IndicativeBadge,
  Money,
  Note,
  PageHeader,
  Panel,
  ScoreBar,
} from "@/components/ui";
import { FreeBetTypeBadge } from "@/components/opportunity-card";

export const dynamic = "force-dynamic";

export default async function OffersPage() {
  const user = await getCurrentUser().catch(() => null);

  const [exchange, bookmaker] = user
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

  const availableCapital = exchange?._sum.balance
    ? new D(exchange._sum.balance.toString()).plus(bookmaker?._sum.balance?.toString() ?? "0")
    : null;

  const opportunities = await buildOpportunities({
    userId: user?.id ?? null,
    availableCapital,
  });

  const awaitingVerification = await prisma.promotion.count({
    where: { status: "NEEDS_VERIFICATION" },
  });

  return (
    <>
      <PageHeader
        title="Offers"
        lede="Every published offer, with how its terms were read and what the current exchange prices calculate to."
      />

      {awaitingVerification > 0 && (
        <div className="mb-4">
          <Note>
            {awaitingVerification} further offer{awaitingVerification === 1 ? " is" : "s are"} held
            back awaiting human verification. Nothing is published on an interpretation alone.
          </Note>
        </div>
      )}

      <Panel>
        {opportunities.length === 0 ? (
          <EmptyState
            title="Nothing published yet"
            body="Offers appear here once an administrator has verified how their terms were read."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table" data-testid="offers-table">
              <thead>
                <tr>
                  <th className="pl-5">Offer</th>
                  <th>Reward</th>
                  <th>Terms</th>
                  <th className="num">Prices</th>
                  <th className="num">Calculated</th>
                  <th className="num">Liability</th>
                  <th className="w-[130px]">Score</th>
                  <th className="pr-5"></th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((opportunity) => (
                  <tr key={opportunity.promotionId} data-testid="offer-row">
                    <td className="pl-5">
                      <div className="text-[13px] font-medium text-ink">{opportunity.title}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
                        <span>{opportunity.operatorName}</span>
                        {opportunity.operatorIsFictional && (
                          <Badge title="An invented operator, used for demonstration.">
                            sample operator
                          </Badge>
                        )}
                      </div>
                    </td>

                    <td className="whitespace-nowrap">
                      {opportunity.tokenValue ? (
                        <span className="figure text-[13px] text-ink">
                          {opportunity.tokenCount && opportunity.tokenCount > 1
                            ? `${opportunity.tokenCount} × £${opportunity.tokenValue}`
                            : `£${opportunity.tokenValue}`}
                        </span>
                      ) : (
                        <span className="text-[12px] text-ink-faint">not stated</span>
                      )}
                      {opportunity.qualifyingStake && (
                        <div className="figure mt-0.5 text-[11px] text-ink-faint">
                          qualify with £{opportunity.qualifyingStake}
                        </div>
                      )}
                    </td>

                    <td>
                      <div className="flex flex-col items-start gap-1">
                        <FreeBetTypeBadge type={opportunity.freeBetType} />
                        <span className="text-[11px] text-ink-faint">
                          {Math.round(opportunity.termsConfidence * 100)}% read
                        </span>
                      </div>
                    </td>

                    <td className="num whitespace-nowrap">
                      {opportunity.candidate ? (
                        <>
                          <div className="figure text-[12px] text-ink-muted">
                            {opportunity.candidate.indicativeBackPrice} /{" "}
                            {opportunity.candidate.bestLayPrice}
                          </div>
                          <div className="mt-1 flex justify-end gap-1">
                            <IndicativeBadge />
                            <DelayBadge delayed={opportunity.candidate.isMarketDataDelayed} />
                          </div>
                        </>
                      ) : (
                        <span className="text-[12px] text-ink-faint">—</span>
                      )}
                    </td>

                    <td className="num whitespace-nowrap">
                      {opportunity.indicativeCalculation ? (
                        <>
                          <Money value={opportunity.indicativeCalculation.guaranteedNet} signed />
                          <div className="figure mt-0.5 text-[11px] text-ink-faint">
                            {opportunity.indicativeCalculation.rating}%
                          </div>
                        </>
                      ) : (
                        <span className="text-[12px] text-ink-faint">—</span>
                      )}
                    </td>

                    <td className="num whitespace-nowrap">
                      {opportunity.indicativeCalculation ? (
                        <Money value={opportunity.indicativeCalculation.liability} size="sm" />
                      ) : (
                        <span className="text-[12px] text-ink-faint">—</span>
                      )}
                    </td>

                    <td>
                      {opportunity.score ? (
                        <>
                          <ScoreBar value={opportunity.score.total} />
                          {!opportunity.score.actionable && (
                            <div className="mt-1">
                              <Badge tone="negative">blocked</Badge>
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-[11px] leading-snug text-ink-faint">
                          {opportunity.unavailableReason}
                        </span>
                      )}
                    </td>

                    <td className="pr-5 text-right">
                      <Link
                        href={`/match?promotion=${opportunity.promotionId}`}
                        data-testid="work-it-out"
                        className="whitespace-nowrap rounded-[4px] border border-line-strong px-2.5 py-1 text-[12px] text-ink hover:bg-surface-sunken"
                      >
                        Work it out
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="mt-4">
        <Note tone="caution">
          Calculated figures use the exchange&rsquo;s own back price as a starting point. They are
          not a bookmaker&rsquo;s prices. Open an offer to enter what your bookmaker is actually
          showing.
        </Note>
      </div>
    </>
  );
}
