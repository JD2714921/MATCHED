/**
 * The engine never throws for bad user input. A calculation that cannot be
 * performed is a *result*, so that the UI can show the reason next to the field
 * that caused it rather than a stack trace.
 */

export type ValidationCode =
  | "BACK_ODDS_TOO_LOW"
  | "BACK_ODDS_TOO_HIGH"
  | "BACK_ODDS_NOT_FINITE"
  | "LAY_ODDS_TOO_LOW"
  | "LAY_ODDS_TOO_HIGH"
  | "LAY_ODDS_NOT_FINITE"
  | "COMMISSION_NEGATIVE"
  | "COMMISSION_TOO_HIGH"
  | "COMMISSION_NOT_FINITE"
  | "STAKE_NOT_POSITIVE"
  | "STAKE_TOO_LARGE"
  | "STAKE_NOT_FINITE"
  | "STAKE_SUB_PENNY"
  | "DENOMINATOR_NOT_POSITIVE"
  | "LADDER_PRICE_INVALID"
  | "LADDER_SIZE_NEGATIVE"
  | "EMPTY_PLAN";

export interface ValidationError {
  code: ValidationCode;
  /** The input field responsible, for form-level display. */
  field: "backStake" | "backOdds" | "layOdds" | "commission" | "ladder" | "plan";
  message: string;
}

export type EngineResult<T> =
  | { ok: true; value: T; warnings: EngineWarning[] }
  | { ok: false; errors: ValidationError[] };

export type WarningCode =
  | "EXTREME_ODDS_GAP"
  | "LARGE_OUTCOME_SPREAD"
  | "NEGATIVE_FREE_BET_RETURN"
  | "LAY_SHORTER_THAN_BACK"
  | "VERY_LOW_STAKE";

export interface EngineWarning {
  code: WarningCode;
  message: string;
}

export function err(errors: ValidationError[]): { ok: false; errors: ValidationError[] } {
  return { ok: false, errors };
}

export function ok<T>(value: T, warnings: EngineWarning[] = []): {
  ok: true;
  value: T;
  warnings: EngineWarning[];
} {
  return { ok: true, value, warnings };
}
