import Link from "next/link";
import type { OpportunityView } from "@/lib/opportunities";
import { Badge, DelayBadge, IndicativeBadge, Money, ScoreBar } from "./ui";

const BET_TYPE_SHORT: Record<string, string> = {
  SNR: "Stake not returned",
  SR: "Stake returned",
  UNKNOWN: "Type not established",
};

/**
 * One opportunity, headlined by a purpose.
 *
 * The Today screen shows four of these — best, easiest, highest return, lowest
 * liability — because "which is best" depends on what the customer is short
 * of, and saying which question each card answers is more useful than four
 * identical cards in score order.
 */
export function OpportunityCard({
  opportunity,
  heading,
  because,
}: {
  opportunity: OpportunityView;
  heading: string;
  because: string;
}) {
  const calculation = opportunity.indicativeCalculation;

  return (
    <div className="flex h-full flex-col rounded-[6px] border border-line bg-surface p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">
        {heading}
      </div>

      <div className="mt-2 min-h-[38px]">
        <div className="text-[13px] font-medium leading-snug text-ink">{opportunity.title}</div>
        <div className="mt-0.5 text-[11px] text-ink-faint">{opportunity.operatorName}</div>
      </div>

      {calculation ? (
        <>
          <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-[11px] text-ink-faint">Calculated return</span>
            <Money value={calculation.guaranteedNet} size="lg" signed />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-[11px] text-ink-faint">Liability</span>
            <Money value={calculation.liability} size="sm" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-[11px] text-ink-faint">Converts</span>
            <span className="figure text-[12px] text-ink-muted">{calculation.rating}%</span>
          </div>
        </>
      ) : (
        <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-ink-muted">
          {opportunity.unavailableReason}
        </p>
      )}

      <div className="mt-3 flex-1 text-[11px] leading-relaxed text-ink-faint">{because}</div>

      {opportunity.candidate && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <IndicativeBadge />
          <DelayBadge delayed={opportunity.candidate.isMarketDataDelayed} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        {opportunity.score ? <ScoreBar value={opportunity.score.total} /> : <span />}
        <Link
          href={`/match?promotion=${opportunity.promotionId}`}
          className="shrink-0 rounded-[4px] bg-accent px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-accent-ink"
        >
          Work it out
        </Link>
      </div>
    </div>
  );
}

export function FreeBetTypeBadge({ type }: { type: string }) {
  if (type === "UNKNOWN") {
    return (
      <Badge tone="caution" title="The terms did not say. This changes a token's value by about a quarter, so it has not been assumed.">
        {BET_TYPE_SHORT[type]}
      </Badge>
    );
  }
  return (
    <Badge tone={type === "SR" ? "positive" : "neutral"}>{BET_TYPE_SHORT[type] ?? type}</Badge>
  );
}
