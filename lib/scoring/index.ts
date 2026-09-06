import type { Decimal, LiquidityAssessment, BetType } from "@/lib/math";

/**
 * Opportunity scoring.
 *
 * Entirely deterministic and entirely transparent: every component reports its
 * own weight, its own score, and a sentence saying why. No language model is
 * involved, and the total is nothing but the weighted sum shown below it — a
 * customer who disagrees with a ranking can see exactly which component they
 * disagree with.
 */

export type ScoreComponentKey =
  | "value"
  | "spread"
  | "liquidity"
  | "capital"
  | "timing"
  | "termsConfidence"
  | "accountState";

export interface ScoreComponent {
  key: ScoreComponentKey;
  label: string;
  /** 0 to 1. The weights sum to exactly 1. */
  weight: number;
  /** 0 to 100. */
  score: number;
  /** weight × score. The total is the sum of these. */
  contribution: number;
  reason: string;
}

export type ScoreBand = "STRONG" | "GOOD" | "FAIR" | "WEAK";

export interface OpportunityScore {
  total: number;
  band: ScoreBand;
  components: ScoreComponent[];
  headline: string;
  /**
   * Reasons this cannot be acted on at all, e.g. nothing to lay against.
   * A weighted average would otherwise let six good components outvote the one
   * that makes the bet impossible to place.
   */
  blockers: string[];
  actionable: boolean;
}

/**
 * Components whose zero means "you cannot do this", not merely "this is poor".
 *
 * An empty book, an event that has started, an offer already used and a
 * position larger than the customer's balance are all hard stops. Everything
 * else — a thin margin, unreadable terms — is a judgement the customer makes.
 */
const BLOCKING_AT_ZERO: ScoreComponentKey[] = ["liquidity", "timing", "accountState", "capital"];

/** A blocked opportunity can never rank above the bottom band. */
const BLOCKED_SCORE_CEILING = 35;

export const COMPONENT_WEIGHTS: Record<ScoreComponentKey, number> = {
  value: 0.3,
  termsConfidence: 0.15,
  liquidity: 0.15,
  capital: 0.15,
  spread: 0.1,
  timing: 0.1,
  accountState: 0.05,
};

export const COMPONENT_LABELS: Record<ScoreComponentKey, string> = {
  value: "Calculated value",
  termsConfidence: "Terms confidence",
  liquidity: "Available liquidity",
  capital: "Capital required",
  spread: "Outcome spread",
  timing: "Timing",
  accountState: "Account state",
};

export type AccountState = "NOT_OPENED" | "OPEN" | "OFFER_USED" | "RESTRICTED" | "CLOSED";

export interface ScoringInput {
  betType: BetType;
  /** The engine's rating, as a percentage. */
  rating: Decimal;
  /** Difference between the two outcomes after rounding, in pounds. */
  outcomeSpread: Decimal;
  liquidity: LiquidityAssessment;
  /** Exchange liability plus any bookmaker stake. */
  totalCapitalRequired: Decimal;
  /** What the customer actually has, or null if they have not said. */
  availableCapital: Decimal | null;
  eventStartsAt: Date;
  now: Date;
  /** When the token expires, if this is a token conversion. */
  tokenExpiresAt: Date | null;
  /** 0 to 1, from the promotion's interpretation. */
  termsConfidence: number;
  accountState: AccountState;
}

const clamp = (value: number, min = 0, max = 100): number =>
  Math.max(min, Math.min(max, value));

/** Linear map from [low, high] onto [0, 100], clamped. */
function ramp(value: number, low: number, high: number): number {
  if (high === low) return value >= high ? 100 : 0;
  return clamp(((value - low) / (high - low)) * 100);
}

const HOUR = 3_600_000;

function scoreValue(input: ScoringInput): { score: number; reason: string } {
  const rating = Number(input.rating.toFixed(2));

  if (input.betType === "QUALIFYING") {
    // A qualifying bet is rated by how much of the stake survives. Losing 1%
    // or less is excellent; 8% or more is poor.
    const lossPercent = 100 - rating;
    const score = ramp(-lossPercent, -8, -1);
    return {
      score,
      reason:
        lossPercent <= 1
          ? `Costs ${lossPercent.toFixed(2)}% of your stake to qualify — about as close as prices get.`
          : lossPercent <= 4
            ? `Costs ${lossPercent.toFixed(2)}% of your stake to qualify, which is normal.`
            : `Costs ${lossPercent.toFixed(2)}% of your stake to qualify, which is expensive.`,
    };
  }

  // A token converting at 85% or better is excellent; below 50% is poor.
  const score = ramp(rating, 50, 85);
  return {
    score,
    reason:
      rating >= 80
        ? `Converts ${rating.toFixed(2)}% of the token's face value.`
        : rating >= 65
          ? `Converts ${rating.toFixed(2)}% of the token's face value, which is workable.`
          : `Converts only ${rating.toFixed(2)}% of the token's face value.`,
  };
}

function scoreSpread(input: ScoringInput): { score: number; reason: string } {
  const spread = Number(input.outcomeSpread.toFixed(2));
  const score = ramp(-spread, -0.5, 0);
  return {
    score,
    reason:
      spread === 0
        ? "The two outcomes come out identical after rounding."
        : `Rounding leaves ${spread.toFixed(2)} between the two outcomes.`,
  };
}

function scoreLiquidity(input: ScoringInput): { score: number; reason: string } {
  const byLevel: Record<LiquidityAssessment["level"], number> = {
    AMPLE: 100,
    SUFFICIENT: 70,
    THIN: 25,
    EMPTY: 0,
  };
  return { score: byLevel[input.liquidity.level], reason: input.liquidity.reason };
}

function scoreCapital(input: ScoringInput): { score: number; reason: string } {
  const required = Number(input.totalCapitalRequired.toFixed(2));

  if (input.availableCapital === null) {
    return {
      score: 60,
      reason: `Ties up ${required.toFixed(2)}. Tell us your balances and this can be scored against what you actually have.`,
    };
  }

  const available = Number(input.availableCapital.toFixed(2));
  if (available <= 0) {
    return { score: 0, reason: `Needs ${required.toFixed(2)} and no balance has been recorded.` };
  }

  const ratio = required / available;
  const score = ramp(-ratio, -1, -0.25);
  return {
    score,
    reason:
      ratio <= 0.25
        ? `Uses ${(ratio * 100).toFixed(0)}% of your available funds.`
        : ratio < 1
          ? `Uses ${(ratio * 100).toFixed(0)}% of your available funds, leaving little for anything else.`
          : `Needs ${required.toFixed(2)} against ${available.toFixed(2)} available — more than you have.`,
  };
}

function scoreTiming(input: ScoringInput): { score: number; reason: string } {
  const hoursAway = (input.eventStartsAt.getTime() - input.now.getTime()) / HOUR;

  if (hoursAway < 0) {
    return { score: 0, reason: "The event has already started." };
  }

  if (input.tokenExpiresAt && input.eventStartsAt > input.tokenExpiresAt) {
    return {
      score: 0,
      reason: "The token expires before this event starts, so it cannot be used here.",
    };
  }

  if (hoursAway < 1) {
    return {
      score: 40,
      reason: "Starts within the hour. Prices move quickly this close to the off.",
    };
  }
  if (hoursAway <= 72) {
    return {
      score: 100,
      reason:
        hoursAway < 24
          ? `Starts in ${Math.round(hoursAway)} hours, so it settles today or tomorrow.`
          : `Starts in ${Math.round(hoursAway / 24)} days, with time to place both bets unhurried.`,
    };
  }
  if (hoursAway <= 168) {
    return {
      score: 70,
      reason: `Starts in ${Math.round(hoursAway / 24)} days, so your capital is tied up for a while.`,
    };
  }
  return {
    score: 40,
    reason: `Starts in ${Math.round(hoursAway / 24)} days, which ties up capital for a long time.`,
  };
}

function scoreTermsConfidence(input: ScoringInput): { score: number; reason: string } {
  const score = clamp(input.termsConfidence * 100);
  return {
    score,
    reason:
      score >= 90
        ? "The terms were read cleanly, including whether the stake is returned."
        : score >= 75
          ? "The terms were read well, with a few details left for a person to confirm."
          : score > 0
            ? "Parts of the terms could not be read. Check the operator's own wording before relying on this."
            : "The terms could not be read at all. Read them yourself before acting on this.",
  };
}

function scoreAccountState(input: ScoringInput): { score: number; reason: string } {
  switch (input.accountState) {
    case "OPEN":
      return { score: 100, reason: "You already have an account with this operator." };
    case "NOT_OPENED":
      return {
        score: 60,
        reason: "You will need to open an account with this operator first.",
      };
    case "OFFER_USED":
      return { score: 0, reason: "You have already used this operator's offer." };
    case "RESTRICTED":
      return { score: 10, reason: "You have marked this account as restricted." };
    case "CLOSED":
      return { score: 0, reason: "You have marked this account as closed." };
  }
}

const SCORERS: Record<ScoreComponentKey, (input: ScoringInput) => { score: number; reason: string }> =
  {
    value: scoreValue,
    spread: scoreSpread,
    liquidity: scoreLiquidity,
    capital: scoreCapital,
    timing: scoreTiming,
    termsConfidence: scoreTermsConfidence,
    accountState: scoreAccountState,
  };

const COMPONENT_ORDER: ScoreComponentKey[] = [
  "value",
  "termsConfidence",
  "liquidity",
  "capital",
  "spread",
  "timing",
  "accountState",
];

export function scoreOpportunity(input: ScoringInput): OpportunityScore {
  const components: ScoreComponent[] = COMPONENT_ORDER.map((key) => {
    const { score, reason } = SCORERS[key](input);
    const weight = COMPONENT_WEIGHTS[key];
    const rounded = Math.round(score * 100) / 100;
    return {
      key,
      label: COMPONENT_LABELS[key],
      weight,
      score: rounded,
      contribution: Math.round(weight * rounded * 100) / 100,
      reason,
    };
  });

  const weighted =
    Math.round(components.reduce((sum, component) => sum + component.contribution, 0) * 100) / 100;

  const blockers = components
    .filter((c) => BLOCKING_AT_ZERO.includes(c.key) && c.score === 0)
    .map((c) => c.reason);

  const total = blockers.length > 0 ? Math.min(weighted, BLOCKED_SCORE_CEILING) : weighted;

  return {
    total,
    band: bandFor(total),
    components,
    headline: headlineFor(total, components, blockers),
    blockers,
    actionable: blockers.length === 0,
  };
}

export function bandFor(total: number): ScoreBand {
  if (total >= 80) return "STRONG";
  if (total >= 65) return "GOOD";
  if (total >= 45) return "FAIR";
  return "WEAK";
}

export const BAND_LABELS: Record<ScoreBand, string> = {
  STRONG: "Strong",
  GOOD: "Good",
  FAIR: "Fair",
  WEAK: "Weak",
};

/** The headline names the component doing the most damage, not the total. */
function headlineFor(
  total: number,
  components: ScoreComponent[],
  blockers: string[],
): string {
  // A blocker is named first whatever the weighted total says. Six good
  // components must never talk over the one that makes the bet unplaceable.
  if (blockers.length > 0) return `Cannot be placed as it stands: ${blockers[0]}`;

  const weakest = [...components].sort(
    (a, b) => a.weight * (100 - a.score) - b.weight * (100 - b.score),
  )[components.length - 1]!;

  if (total >= 80 && weakest.score >= 70) return "Everything lines up on this one.";
  if (weakest.score >= 80) return "No single weak point — just a middling opportunity.";
  return `Held back by ${weakest.label.toLowerCase()}: ${weakest.reason}`;
}
