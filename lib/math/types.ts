import type { Decimal } from "./decimal";
import type { RoundingMode } from "./decimal";

/**
 * The three shapes a matched-betting leg can take. The distinction between the
 * two free-bet forms is the single most valuable fact in a promotion's terms:
 * on a £30 token at typical odds it is worth roughly a quarter of the token.
 */
export type BetType = "QUALIFYING" | "FREE_BET_SNR" | "FREE_BET_SR";

export const BET_TYPE_LABELS: Record<BetType, string> = {
  QUALIFYING: "Qualifying bet (your own money, stake returned)",
  FREE_BET_SNR: "Free bet — stake not returned (SNR)",
  FREE_BET_SR: "Free bet — stake returned (SR)",
};

/** Which side of the back bet came in. */
export type Outcome = "BACK_WINS" | "BACK_LOSES";

export interface HedgeInput {
  betType: BetType;
  /** B — the back stake at the bookmaker, or the face value of the token. */
  backStake: Decimal;
  /** b — decimal odds at the bookmaker. */
  backOdds: Decimal;
  /** l — decimal odds available to lay on the exchange. */
  layOdds: Decimal;
  /** c — exchange commission as a rate, e.g. 0.05 for 5%. */
  commission: Decimal;
  rounding: RoundingMode;
}

/**
 * One line of a settlement.
 *
 * `amount` is already rounded to pence. The invariant the engine guarantees —
 * and which is asserted in tests — is that the line items of an outcome sum
 * EXACTLY to that outcome's net. The matrix is the proof of the number, not a
 * restatement of it.
 */
export interface SettlementLine {
  label: string;
  /** Signed, in pounds, rounded to 2dp. */
  amount: Decimal;
  /** Where the money moves. */
  venue: "BOOKMAKER" | "EXCHANGE" | "NONE";
  /** Short explanation shown alongside the figure. */
  note?: string;
}

export interface OutcomeResult {
  outcome: Outcome;
  /** Human label, e.g. "Your selection wins at the bookmaker". */
  label: string;
  lines: SettlementLine[];
  /** The sum of `lines[].amount`. Not computed independently. */
  net: Decimal;
}

export interface HedgeResult {
  input: HedgeInput;
  /** The unrounded equalising lay stake. Kept for transparency only. */
  idealLayStake: Decimal;
  /** The stake the customer should actually place. */
  layStake: Decimal;
  /** S(l-1) at the rounded stake — the money the exchange holds. */
  liability: Decimal;
  backWins: OutcomeResult;
  backLoses: OutcomeResult;
  /** The worse of the two outcomes: what is locked in whatever happens. */
  guaranteedNet: Decimal;
  /** The better of the two outcomes. */
  bestCaseNet: Decimal;
  /** bestCaseNet - guaranteedNet. Zero only when rounding lands exactly. */
  outcomeSpread: Decimal;
  /**
   * For a qualifying bet: the proportion of the back stake retained.
   * For a free bet: the proportion of the token's face value converted.
   * Expressed as a percentage, computed from `guaranteedNet`.
   */
  rating: Decimal;
  /** Money that must be available at the exchange. */
  exchangeCapitalRequired: Decimal;
  /** Money that must be available at the bookmaker (zero for a free bet). */
  bookmakerCapitalRequired: Decimal;
}

export interface LadderLevel {
  /** Decimal odds. */
  price: Decimal;
  /**
   * Lay stake matchable at this price, expressed as the stake YOU would place.
   * Providers are responsible for translating their own convention into this.
   */
  size: Decimal;
}

export interface MatchFill {
  price: Decimal;
  size: Decimal;
}

export interface MatchResult {
  /** How much of the desired stake can be placed at or better than target. */
  matched: Decimal;
  unmatched: Decimal;
  fills: MatchFill[];
  /** Volume-weighted average price actually achieved, or null if nothing fills. */
  averagePrice: Decimal | null;
  fullyMatched: boolean;
}

export type LiquidityLevel = "AMPLE" | "SUFFICIENT" | "THIN" | "EMPTY";

export interface LiquidityAssessment {
  /** Cumulative size at prices at or better than the target. */
  depthAtOrBetter: Decimal;
  requiredStake: Decimal;
  /** depthAtOrBetter / requiredStake, capped for display at 99. */
  coverage: Decimal;
  level: LiquidityLevel;
  reason: string;
}

export interface RepriceResult {
  previous: HedgeResult;
  current: HedgeResult;
  layStakeDelta: Decimal;
  guaranteedNetDelta: Decimal;
  liabilityDelta: Decimal;
  materialChange: boolean;
  reason: string;
}

export type TokenPlanMode = "SEQUENTIAL" | "CONCURRENT";

export interface TokenPlan {
  mode: TokenPlanMode;
  legs: HedgeResult[];
  /** max(liability) when sequential, sum(liability) when concurrent. */
  exchangeCapitalRequired: Decimal;
  bookmakerCapitalRequired: Decimal;
  totalGuaranteedNet: Decimal;
  totalFaceValue: Decimal;
  /** totalGuaranteedNet / totalFaceValue as a percentage. */
  blendedRating: Decimal;
  explanation: string;
}

export interface BankrollRequirement {
  exchangeBalance: Decimal;
  bookmakerBalance: Decimal;
  total: Decimal;
  /** Recommended buffer above the strict minimum, as a rate. */
  bufferRate: Decimal;
  recommendedTotal: Decimal;
  peakLiability: Decimal;
}
