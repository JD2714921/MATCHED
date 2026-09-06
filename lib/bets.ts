import type { BetLeg, BetPlan } from "@prisma/client";
import { D, money, sum, type Decimal } from "@/lib/math";

/**
 * Realised results.
 *
 * Computed from what the customer ACTUALLY got — their real stakes, their real
 * fill prices, their real commission — never from what was suggested. A lay
 * that filled at 3.35 instead of 3.25 is a worse position, and the profit
 * record should say so rather than flattering the suggestion.
 */

export interface LegActuals {
  stake: Decimal;
  odds: Decimal;
  commissionRate: Decimal;
  usedSuggestion: boolean;
}

export function legActuals(leg: BetLeg): LegActuals {
  const usedSuggestion = leg.actualStake === null || leg.actualOdds === null;
  return {
    stake: new D((leg.actualStake ?? leg.suggestedStake).toString()),
    odds: new D((leg.actualOdds ?? leg.suggestedOdds).toString()),
    commissionRate: new D(leg.commissionRate.toString()),
    usedSuggestion,
  };
}

/**
 * The cash outcome of one settled leg.
 *
 * Signed from the customer's point of view, so the legs of a position simply
 * add up.
 */
export function legNet(leg: BetLeg): Decimal | null {
  if (leg.outcome === "PENDING") return null;

  const { stake, odds, commissionRate } = legActuals(leg);
  const isFreeBet = leg.betType === "FREE_BET_SNR" || leg.betType === "FREE_BET_SR";

  if (leg.outcome === "VOID") {
    // A void back bet returns the stake; a void lay returns the liability.
    return new D(0);
  }

  if (leg.side === "BACK") {
    if (leg.outcome === "WON") {
      if (leg.betType === "FREE_BET_SNR") return money(stake.times(odds.minus(1)));
      if (leg.betType === "FREE_BET_SR") return money(stake.times(odds));
      return money(stake.times(odds.minus(1)));
    }
    // Lost: a free bet costs nothing, your own money is gone.
    return isFreeBet ? new D(0) : money(stake.negated());
  }

  // Lay leg. "WON" on a lay means the lay won — the backed selection lost.
  if (leg.outcome === "WON") return money(stake.times(new D(1).minus(commissionRate)));
  return money(stake.negated().times(odds.minus(1)));
}

export interface RealisedResult {
  net: Decimal | null;
  settledLegs: number;
  totalLegs: number;
  complete: boolean;
  /** True when any leg is still using the suggested figures. */
  usingSuggestions: boolean;
}

export function realisedResult(legs: BetLeg[]): RealisedResult {
  const nets = legs.map(legNet);
  const settled = nets.filter((n): n is Decimal => n !== null);

  return {
    net: settled.length === legs.length && legs.length > 0 ? money(sum(settled)) : null,
    settledLegs: settled.length,
    totalLegs: legs.length,
    complete: legs.length > 0 && settled.length === legs.length,
    usingSuggestions: legs.some((leg) => legActuals(leg).usedSuggestion),
  };
}

export const PLAN_STAGES: Array<{ status: BetPlan["status"]; label: string; description: string }> =
  [
    { status: "PLANNED", label: "Planned", description: "Calculated, nothing placed yet." },
    {
      status: "QUALIFYING_PLACED",
      label: "Qualifying placed",
      description: "Both legs of the qualifying bet are on.",
    },
    {
      status: "QUALIFYING_SETTLED",
      label: "Qualifying settled",
      description: "The qualifying bet has settled.",
    },
    {
      status: "TOKEN_RECEIVED",
      label: "Token received",
      description: "The free bet has landed in your account.",
    },
    {
      status: "CONVERSION_PLACED",
      label: "Conversion placed",
      description: "Both legs of the free-bet conversion are on.",
    },
    {
      status: "COMPLETED",
      label: "Completed",
      description: "Everything has settled and the result is recorded.",
    },
  ];

export function stageIndex(status: BetPlan["status"]): number {
  return PLAN_STAGES.findIndex((stage) => stage.status === status);
}

export function nextStage(status: BetPlan["status"]): BetPlan["status"] | null {
  const index = stageIndex(status);
  if (index < 0 || index >= PLAN_STAGES.length - 1) return null;
  return PLAN_STAGES[index + 1]!.status;
}
