import type {
  Decimal,
  HedgeResult,
  LiquidityAssessment,
  OutcomeResult,
  SettlementLine,
  MatchResult,
} from "@/lib/math";

/**
 * Decimals cross every boundary as STRINGS.
 *
 * A JSON number would silently reintroduce the floating-point error the whole
 * engine exists to avoid: JSON.parse("22.50") is a double, and the moment it
 * is added to anything the guarantee is gone. Everything below is the one
 * place decimals become text, and it always produces text.
 */

export const asMoney = (value: Decimal): string => value.toFixed(2);
export const asRate = (value: Decimal): string => value.toFixed(4);
export const asOdds = (value: Decimal): string => value.toFixed(2);

export interface SerializedLine {
  label: string;
  amount: string;
  venue: SettlementLine["venue"];
  note: string | null;
}

export interface SerializedOutcome {
  outcome: OutcomeResult["outcome"];
  label: string;
  lines: SerializedLine[];
  net: string;
}

export interface SerializedHedge {
  betType: HedgeResult["input"]["betType"];
  rounding: HedgeResult["input"]["rounding"];
  backStake: string;
  backOdds: string;
  layOdds: string;
  commission: string;
  idealLayStake: string;
  layStake: string;
  liability: string;
  backWins: SerializedOutcome;
  backLoses: SerializedOutcome;
  guaranteedNet: string;
  bestCaseNet: string;
  outcomeSpread: string;
  rating: string;
  exchangeCapitalRequired: string;
  bookmakerCapitalRequired: string;
}

function serializeOutcome(outcome: OutcomeResult): SerializedOutcome {
  return {
    outcome: outcome.outcome,
    label: outcome.label,
    lines: outcome.lines.map((line) => ({
      label: line.label,
      amount: asMoney(line.amount),
      venue: line.venue,
      note: line.note ?? null,
    })),
    net: asMoney(outcome.net),
  };
}

export function serializeHedge(result: HedgeResult): SerializedHedge {
  return {
    betType: result.input.betType,
    rounding: result.input.rounding,
    backStake: asMoney(result.input.backStake),
    backOdds: asOdds(result.input.backOdds),
    layOdds: asOdds(result.input.layOdds),
    commission: asRate(result.input.commission),
    idealLayStake: result.idealLayStake.toFixed(4),
    layStake: asMoney(result.layStake),
    liability: asMoney(result.liability),
    backWins: serializeOutcome(result.backWins),
    backLoses: serializeOutcome(result.backLoses),
    guaranteedNet: asMoney(result.guaranteedNet),
    bestCaseNet: asMoney(result.bestCaseNet),
    outcomeSpread: asMoney(result.outcomeSpread),
    rating: result.rating.toFixed(2),
    exchangeCapitalRequired: asMoney(result.exchangeCapitalRequired),
    bookmakerCapitalRequired: asMoney(result.bookmakerCapitalRequired),
  };
}

export interface SerializedLiquidity {
  depthAtOrBetter: string;
  requiredStake: string;
  coverage: string;
  level: LiquidityAssessment["level"];
  reason: string;
}

export function serializeLiquidity(assessment: LiquidityAssessment): SerializedLiquidity {
  return {
    depthAtOrBetter: asMoney(assessment.depthAtOrBetter),
    requiredStake: asMoney(assessment.requiredStake),
    coverage: assessment.coverage.toFixed(2),
    level: assessment.level,
    reason: assessment.reason,
  };
}

export interface SerializedMatch {
  matched: string;
  unmatched: string;
  fills: Array<{ price: string; size: string }>;
  averagePrice: string | null;
  fullyMatched: boolean;
}

export function serializeMatch(match: MatchResult): SerializedMatch {
  return {
    matched: asMoney(match.matched),
    unmatched: asMoney(match.unmatched),
    fills: match.fills.map((fill) => ({ price: asOdds(fill.price), size: asMoney(fill.size) })),
    averagePrice: match.averagePrice ? asOdds(match.averagePrice) : null,
    fullyMatched: match.fullyMatched,
  };
}

/** Format a money string for display, with a sign where one clarifies. */
export function formatMoney(value: string, options: { signed?: boolean } = {}): string {
  const numeric = value.startsWith("-");
  const bare = numeric ? value.slice(1) : value;
  if (numeric) return `−£${bare}`;
  return options.signed ? `+£${bare}` : `£${bare}`;
}

export function formatPercent(value: string): string {
  return `${value}%`;
}
