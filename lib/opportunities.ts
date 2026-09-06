import type { Promotion, Operator, AccountStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  D,
  DEFAULT_ROUNDING,
  assessLiquidity,
  bestBackPrice,
  bestLayPrice,
  calculateHedge,
  type BetType,
  type Decimal,
  type HedgeResult,
  type LadderLevel,
  type LiquidityAssessment,
} from "@/lib/math";
import { getExchangeProvider } from "@/lib/exchange";
import { scoreOpportunity, type OpportunityScore, type AccountState } from "@/lib/scoring";
import {
  serializeHedge,
  serializeLiquidity,
  asMoney,
  asOdds,
  type SerializedHedge,
  type SerializedLiquidity,
} from "@/lib/serialize";

/**
 * Turning published promotions into ranked, calculated opportunities.
 *
 * THE HONESTY POINT THAT SHAPES ALL OF THIS: there is no bookmaker odds feed.
 * The back bet happens at a bookmaker; we only have exchange data. So the back
 * price used below is the EXCHANGE's best available back price, used as an
 * indicative starting point and labelled as such at every single place it
 * surfaces. Nothing here is a real calculation until the customer types in the
 * price their own bookmaker is actually showing — and that entered price
 * applies only to the selection they have open, because a bookmaker's price
 * for one selection says nothing about another.
 */

export const DEFAULT_COMMISSION = "0.05";

export interface CandidateMarket {
  eventId: string;
  eventName: string;
  competition: string | null;
  eventStartsAt: string;
  marketId: string;
  marketName: string;
  selectionId: string;
  selectionName: string;
  /** EXCHANGE back price. Indicative only — never a bookmaker price. */
  indicativeBackPrice: string;
  bestLayPrice: string;
  isMarketDataDelayed: boolean;
  tradedVolumeAvailable: boolean;
  liquidity: SerializedLiquidity;
}

export interface OpportunityView {
  promotionId: string;
  operatorId: string;
  operatorName: string;
  operatorIsFictional: boolean;
  title: string;
  kind: Promotion["kind"];
  status: Promotion["status"];
  freeBetType: Promotion["freeBetType"];
  tokenValue: string | null;
  tokenCount: number | null;
  qualifyingStake: string | null;
  minQualifyingOdds: string | null;
  minRewardOdds: string | null;
  freeBetExpiryDays: number | null;
  termsConfidence: number;
  accountStatus: AccountStatus;
  candidate: CandidateMarket | null;
  /**
   * The calculated conversion at the INDICATIVE back price. Always labelled.
   * Null when no compatible market could be found.
   */
  indicativeCalculation: SerializedHedge | null;
  score: OpportunityScore | null;
  /** Why there is no calculation, when there is none. */
  unavailableReason: string | null;
}

interface SelectionCandidate {
  eventId: string;
  eventName: string;
  competition: string | null;
  eventStartsAt: Date;
  marketId: string;
  marketName: string;
  selectionId: string;
  selectionName: string;
  backPrice: Decimal;
  layPrice: Decimal;
  layLadder: LadderLevel[];
  isMarketDataDelayed: boolean;
  tradedVolumeAvailable: boolean;
  hedge: HedgeResult;
  liquidity: LiquidityAssessment;
}

export function betTypeForPromotion(promotion: Promotion): BetType {
  switch (promotion.freeBetType) {
    case "SR":
      return "FREE_BET_SR";
    case "SNR":
      return "FREE_BET_SNR";
    default:
      // An unread free-bet type must not silently become the common case; the
      // caller checks for UNKNOWN before using this.
      return "FREE_BET_SNR";
  }
}

function accountStateOf(status: AccountStatus): AccountState {
  return status;
}

/** The token's face value: per-token where stated, else the whole reward. */
export function tokenFaceValue(promotion: Promotion): Decimal | null {
  if (promotion.rewardTokenValue) return new D(promotion.rewardTokenValue.toString());
  if (promotion.rewardTotalValue) return new D(promotion.rewardTotalValue.toString());
  return null;
}

/**
 * Search the exchange for the selection that converts a token best.
 *
 * "Best" is decided by running the real engine over every candidate and taking
 * the highest calculated return — not by a heuristic about which prices look
 * close.
 */
export async function findBestCandidate(args: {
  betType: BetType;
  faceValue: Decimal;
  minOdds: Decimal | null;
  commission: Decimal;
  limitEvents?: number;
}): Promise<SelectionCandidate | null> {
  const provider = getExchangeProvider();
  const events = await provider.getEvents({ limit: args.limitEvents ?? 8 });

  let best: SelectionCandidate | null = null;

  for (const event of events) {
    const markets = await provider.getMarkets(event.id);
    if (markets.length === 0) continue;

    const priced = await provider.getPrices(markets.map((m) => m.id));

    for (const marketPrices of priced) {
      const market = markets.find((m) => m.id === marketPrices.marketId);
      if (!market) continue;

      for (const selection of marketPrices.selections) {
        const backPrice = bestBackPrice(selection.availableToBack);
        const layPrice = bestLayPrice(selection.availableToLay);
        if (!backPrice || !layPrice) continue;

        // Respect the promotion's own minimum odds, read from its terms.
        if (args.minOdds && backPrice.lessThan(args.minOdds)) continue;

        const calculated = calculateHedge({
          betType: args.betType,
          backStake: args.faceValue,
          backOdds: backPrice,
          layOdds: layPrice,
          commission: args.commission,
          rounding: DEFAULT_ROUNDING,
        });
        if (!calculated.ok) continue;

        const liquidity = assessLiquidity(
          selection.availableToLay,
          layPrice,
          calculated.value.layStake,
        );

        const candidate: SelectionCandidate = {
          eventId: event.id,
          eventName: event.name,
          competition: event.competition,
          eventStartsAt: event.startsAt,
          marketId: market.id,
          marketName: market.name,
          selectionId: selection.selectionId,
          selectionName: selection.selectionName,
          backPrice,
          layPrice,
          layLadder: selection.availableToLay,
          isMarketDataDelayed: marketPrices.isMarketDataDelayed,
          tradedVolumeAvailable: marketPrices.tradedVolumeAvailable,
          hedge: calculated.value,
          liquidity,
        };

        if (!best || candidate.hedge.guaranteedNet.greaterThan(best.hedge.guaranteedNet)) {
          best = candidate;
        }
      }
    }
  }

  return best;
}

function serializeCandidate(candidate: SelectionCandidate): CandidateMarket {
  return {
    eventId: candidate.eventId,
    eventName: candidate.eventName,
    competition: candidate.competition,
    eventStartsAt: candidate.eventStartsAt.toISOString(),
    marketId: candidate.marketId,
    marketName: candidate.marketName,
    selectionId: candidate.selectionId,
    selectionName: candidate.selectionName,
    indicativeBackPrice: asOdds(candidate.backPrice),
    bestLayPrice: asOdds(candidate.layPrice),
    isMarketDataDelayed: candidate.isMarketDataDelayed,
    tradedVolumeAvailable: candidate.tradedVolumeAvailable,
    liquidity: serializeLiquidity(candidate.liquidity),
  };
}

export interface BuildOpportunitiesOptions {
  userId: string | null;
  now?: Date;
  availableCapital?: Decimal | null;
}

/**
 * Build the ranked opportunity list from every PUBLISHED promotion.
 */
export async function buildOpportunities(
  options: BuildOpportunitiesOptions,
): Promise<OpportunityView[]> {
  const now = options.now ?? new Date();
  const commission = new D(DEFAULT_COMMISSION);

  const promotions = await prisma.promotion.findMany({
    where: { status: "PUBLISHED" },
    include: {
      operator: true,
      interpretations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });

  const accounts = options.userId
    ? await prisma.userOperatorAccount.findMany({ where: { userId: options.userId } })
    : [];
  const accountByOperator = new Map(accounts.map((a) => [a.operatorId, a.status]));

  const views: OpportunityView[] = [];

  for (const promotion of promotions) {
    const view = await buildOne({
      promotion,
      operator: promotion.operator,
      termsConfidence: promotion.interpretations[0]
        ? Number(promotion.interpretations[0].confidence)
        : 0,
      accountStatus: accountByOperator.get(promotion.operatorId) ?? "NOT_OPENED",
      commission,
      now,
      availableCapital: options.availableCapital ?? null,
    });
    views.push(view);
  }

  // Rank by score, unactionable last.
  return views.sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1));
}

async function buildOne(args: {
  promotion: Promotion;
  operator: Operator;
  termsConfidence: number;
  accountStatus: AccountStatus;
  commission: Decimal;
  now: Date;
  availableCapital: Decimal | null;
}): Promise<OpportunityView> {
  const { promotion, operator } = args;

  const base: Omit<OpportunityView, "candidate" | "indicativeCalculation" | "score" | "unavailableReason"> = {
    promotionId: promotion.id,
    operatorId: operator.id,
    operatorName: operator.name,
    operatorIsFictional: operator.isFictional,
    title: promotion.title,
    kind: promotion.kind,
    status: promotion.status,
    freeBetType: promotion.freeBetType,
    tokenValue: promotion.rewardTokenValue ? asMoney(new D(promotion.rewardTokenValue.toString())) : null,
    tokenCount: promotion.rewardTokenCount,
    qualifyingStake: promotion.qualifyingStake
      ? asMoney(new D(promotion.qualifyingStake.toString()))
      : null,
    minQualifyingOdds: promotion.minQualifyingOdds
      ? asOdds(new D(promotion.minQualifyingOdds.toString()))
      : null,
    minRewardOdds: promotion.minRewardOdds ? asOdds(new D(promotion.minRewardOdds.toString())) : null,
    freeBetExpiryDays: promotion.freeBetExpiryDays,
    termsConfidence: args.termsConfidence,
    accountStatus: args.accountStatus,
  };

  const faceValue = tokenFaceValue(promotion);
  if (!faceValue) {
    return {
      ...base,
      candidate: null,
      indicativeCalculation: null,
      score: null,
      unavailableReason: "No reward value was read from the terms, so there is nothing to calculate.",
    };
  }

  if (promotion.freeBetType === "UNKNOWN") {
    return {
      ...base,
      candidate: null,
      indicativeCalculation: null,
      score: null,
      unavailableReason:
        "The terms do not say whether the free-bet stake is returned. Its value cannot be calculated until a person establishes that.",
    };
  }

  const candidate = await findBestCandidate({
    betType: betTypeForPromotion(promotion),
    faceValue,
    minOdds: promotion.minRewardOdds ? new D(promotion.minRewardOdds.toString()) : null,
    commission: args.commission,
  });

  if (!candidate) {
    return {
      ...base,
      candidate: null,
      indicativeCalculation: null,
      score: null,
      unavailableReason:
        "No exchange market currently meets this promotion's minimum odds with a price on both sides.",
    };
  }

  const tokenExpiresAt =
    promotion.freeBetExpiryDays !== null
      ? new Date(args.now.getTime() + promotion.freeBetExpiryDays * 24 * 3_600_000)
      : null;

  const score = scoreOpportunity({
    betType: betTypeForPromotion(promotion),
    rating: candidate.hedge.rating,
    outcomeSpread: candidate.hedge.outcomeSpread,
    liquidity: candidate.liquidity,
    totalCapitalRequired: candidate.hedge.exchangeCapitalRequired.plus(
      candidate.hedge.bookmakerCapitalRequired,
    ),
    availableCapital: args.availableCapital,
    eventStartsAt: candidate.eventStartsAt,
    now: args.now,
    tokenExpiresAt,
    termsConfidence: args.termsConfidence,
    accountState: accountStateOf(args.accountStatus),
  });

  return {
    ...base,
    candidate: serializeCandidate(candidate),
    indicativeCalculation: serializeHedge(candidate.hedge),
    score,
    unavailableReason: null,
  };
}

/** Totals for the Today hero. */
export interface TodaySummary {
  goodOpportunityCount: number;
  calculatedPromotionalValue: string;
  capitalRequired: string;
  highestLiability: string;
}

export function summarise(opportunities: OpportunityView[]): TodaySummary {
  const actionable = opportunities.filter((o) => o.score?.actionable && o.indicativeCalculation);

  let value = new D(0);
  let capital = new D(0);
  let highest = new D(0);

  for (const opportunity of actionable) {
    const calculation = opportunity.indicativeCalculation!;
    value = value.plus(new D(calculation.guaranteedNet));
    capital = capital.plus(new D(calculation.exchangeCapitalRequired));
    const liability = new D(calculation.liability);
    if (liability.greaterThan(highest)) highest = liability;
  }

  return {
    goodOpportunityCount: actionable.filter((o) => (o.score?.total ?? 0) >= 65).length,
    calculatedPromotionalValue: asMoney(value),
    capitalRequired: asMoney(capital),
    highestLiability: asMoney(highest),
  };
}
