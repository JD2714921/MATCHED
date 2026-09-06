import { D, type Decimal } from "./decimal";
import type { HedgeInput, LadderLevel } from "./types";
import type { ValidationError } from "./errors";

/**
 * Bounds. Betfair's own price range is 1.01 to 1000, and no sane bookmaker
 * quotes outside it either, so the same limits apply to both sides.
 */
export const MIN_ODDS = new D("1.01");
export const MAX_ODDS = new D("1000");
export const MAX_COMMISSION = new D("0.5");
export const MIN_STAKE = new D("0.01");
export const MAX_STAKE = new D("1000000");

function finite(v: Decimal): boolean {
  return v.isFinite() && !v.isNaN();
}

export function validateOdds(
  value: Decimal,
  field: "backOdds" | "layOdds",
): ValidationError[] {
  const errors: ValidationError[] = [];
  const side = field === "backOdds" ? "Back" : "Lay";
  if (!finite(value)) {
    errors.push({
      code: field === "backOdds" ? "BACK_ODDS_NOT_FINITE" : "LAY_ODDS_NOT_FINITE",
      field,
      message: `${side} odds must be a number.`,
    });
    return errors;
  }
  if (value.lessThan(MIN_ODDS)) {
    errors.push({
      code: field === "backOdds" ? "BACK_ODDS_TOO_LOW" : "LAY_ODDS_TOO_LOW",
      field,
      message: `${side} odds must be at least ${MIN_ODDS.toFixed(2)}.`,
    });
  }
  if (value.greaterThan(MAX_ODDS)) {
    errors.push({
      code: field === "backOdds" ? "BACK_ODDS_TOO_HIGH" : "LAY_ODDS_TOO_HIGH",
      field,
      message: `${side} odds must be ${MAX_ODDS.toFixed(0)} or less.`,
    });
  }
  return errors;
}

export function validateCommission(value: Decimal): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!finite(value)) {
    errors.push({
      code: "COMMISSION_NOT_FINITE",
      field: "commission",
      message: "Commission must be a number.",
    });
    return errors;
  }
  if (value.isNegative()) {
    errors.push({
      code: "COMMISSION_NEGATIVE",
      field: "commission",
      message: "Commission cannot be negative.",
    });
  }
  if (value.greaterThan(MAX_COMMISSION)) {
    errors.push({
      code: "COMMISSION_TOO_HIGH",
      field: "commission",
      message: `Commission above ${MAX_COMMISSION.times(100).toFixed(0)}% is not a real exchange rate.`,
    });
  }
  return errors;
}

export function validateStake(value: Decimal): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!finite(value)) {
    errors.push({
      code: "STAKE_NOT_FINITE",
      field: "backStake",
      message: "Stake must be a number.",
    });
    return errors;
  }
  if (value.lessThanOrEqualTo(0)) {
    errors.push({
      code: "STAKE_NOT_POSITIVE",
      field: "backStake",
      message: "Stake must be greater than zero.",
    });
    return errors;
  }
  if (value.lessThan(MIN_STAKE)) {
    errors.push({
      code: "STAKE_SUB_PENNY",
      field: "backStake",
      message: "Stake must be at least one penny.",
    });
  }
  if (value.greaterThan(MAX_STAKE)) {
    errors.push({
      code: "STAKE_TOO_LARGE",
      field: "backStake",
      message: "Stake is beyond the range this tool supports.",
    });
  }
  return errors;
}

export function validateHedgeInput(input: HedgeInput): ValidationError[] {
  const errors: ValidationError[] = [
    ...validateStake(input.backStake),
    ...validateOdds(input.backOdds, "backOdds"),
    ...validateOdds(input.layOdds, "layOdds"),
    ...validateCommission(input.commission),
  ];

  // Guard the denominator explicitly rather than relying on the bounds above to
  // imply it. l - c is positive for every l >= 1.01 and c <= 0.5, but the check
  // is cheap and the failure mode (a division by zero producing Infinity) would
  // be silent.
  if (errors.length === 0) {
    const denominator = input.layOdds.minus(input.commission);
    if (denominator.lessThanOrEqualTo(0)) {
      errors.push({
        code: "DENOMINATOR_NOT_POSITIVE",
        field: "layOdds",
        message: "Lay odds minus commission must be greater than zero.",
      });
    }
  }

  return errors;
}

export function validateLadder(levels: LadderLevel[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const level of levels) {
    if (!finite(level.price) || level.price.lessThan(MIN_ODDS) || level.price.greaterThan(MAX_ODDS)) {
      errors.push({
        code: "LADDER_PRICE_INVALID",
        field: "ladder",
        message: `Ladder contains an out-of-range price: ${level.price.toString()}.`,
      });
    }
    if (!finite(level.size) || level.size.isNegative()) {
      errors.push({
        code: "LADDER_SIZE_NEGATIVE",
        field: "ladder",
        message: `Ladder contains a negative size at price ${level.price.toString()}.`,
      });
    }
  }
  return errors;
}
