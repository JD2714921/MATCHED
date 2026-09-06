/**
 * MATCHED calculation engine.
 *
 * ISOLATION RULE: every module under lib/math may import decimal.js and other
 * files in lib/math, and NOTHING else. No database, no network, no logger, no
 * framework. `purity.test.ts` walks the import graph and fails the build if this
 * is ever violated.
 *
 * That isolation is what makes every figure in the product traceable: a number
 * shown to a customer is the output of a pure function of its inputs, and the
 * settlement matrix beside it adds up by hand.
 */

export {
  D,
  ZERO,
  ONE,
  HUNDRED,
  dec,
  parseDecimal,
  money,
  rate,
  roundStake,
  sum,
  minOf,
  maxOf,
  toMoneyString,
  toRateString,
  DEFAULT_ROUNDING,
  ROUNDING_MODE_LABELS,
  ROUNDING_MODE_DESCRIPTIONS,
  type Decimal,
  type RoundingMode,
} from "./decimal";

export {
  BET_TYPE_LABELS,
  type BetType,
  type Outcome,
  type HedgeInput,
  type HedgeResult,
  type OutcomeResult,
  type SettlementLine,
  type LadderLevel,
  type MatchFill,
  type MatchResult,
  type LiquidityLevel,
  type LiquidityAssessment,
  type RepriceResult,
  type TokenPlan,
  type TokenPlanMode,
  type BankrollRequirement,
} from "./types";

export {
  ok,
  err,
  type EngineResult,
  type EngineWarning,
  type ValidationCode,
  type ValidationError,
  type WarningCode,
} from "./errors";

export {
  MIN_ODDS,
  MAX_ODDS,
  MAX_COMMISSION,
  MIN_STAKE,
  MAX_STAKE,
  validateHedgeInput,
  validateLadder,
  validateOdds,
  validateCommission,
  validateStake,
} from "./validate";

export { calculateHedge, hedgeFromStrings, idealLayStake } from "./hedge";

export {
  sortLayLadder,
  depthAtOrBetter,
  matchLayStake,
  assessLiquidity,
  bestLayPrice,
  bestBackPrice,
} from "./ladder";

export {
  reprice,
  DEFAULT_REPRICE_THRESHOLDS,
  type RepriceThresholds,
} from "./repricing";

export { planTokens, repeatToken, DEFAULT_PLAN_MODE } from "./tokens";

export {
  bankrollRequirement,
  bankrollShortfall,
  DEFAULT_BUFFER_RATE,
} from "./bankroll";
