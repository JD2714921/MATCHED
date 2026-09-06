import Decimal from "decimal.js";

/**
 * The engine's numeric substrate.
 *
 * A cloned constructor rather than the global `Decimal` so that configuring the
 * engine can never change the behaviour of decimal.js elsewhere in the process
 * (and so nothing elsewhere can change the behaviour of the engine).
 *
 * Precision is set far above what money needs because intermediate values —
 * B*b / (l - c) in particular — are frequently non-terminating.
 */
export const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 30,
});

export type { Decimal };

export const ZERO = new D(0);
export const ONE = new D(1);
export const HUNDRED = new D(100);

/**
 * How a lay stake is rounded before it is shown to a customer.
 *
 * This is not a display concern. A customer cannot place a fraction of a penny,
 * so the rounded stake is the *real* stake, and every outcome figure must be
 * recomputed from it.
 */
export type RoundingMode =
  | "NEAREST_PENNY"
  | "NEAREST_10P"
  | "NEAREST_50P"
  | "DOWN_PENNY"
  | "UP_PENNY";

export const DEFAULT_ROUNDING: RoundingMode = "NEAREST_PENNY";

export const ROUNDING_MODE_LABELS: Record<RoundingMode, string> = {
  NEAREST_PENNY: "Nearest penny",
  NEAREST_10P: "Nearest 10p",
  NEAREST_50P: "Nearest 50p",
  DOWN_PENNY: "Round down (under-lay)",
  UP_PENNY: "Round up (over-lay)",
};

export const ROUNDING_MODE_DESCRIPTIONS: Record<RoundingMode, string> = {
  NEAREST_PENNY: "Closest to the equalised stake. Smallest difference between outcomes.",
  NEAREST_10P: "Easier to type into an exchange. Slightly uneven outcomes.",
  NEAREST_50P: "Coarsest rounding. Noticeably uneven outcomes on small stakes.",
  DOWN_PENNY: "Lays slightly less than equalised, leaving you marginally exposed to the back winning.",
  UP_PENNY: "Lays slightly more than equalised, leaving you marginally exposed to the back losing.",
};

/** Round a raw amount to a placeable stake under the given mode. */
export function roundStake(value: Decimal, mode: RoundingMode): Decimal {
  switch (mode) {
    case "NEAREST_PENNY":
      return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    case "DOWN_PENNY":
      return value.toDecimalPlaces(2, Decimal.ROUND_DOWN);
    case "UP_PENNY":
      return value.toDecimalPlaces(2, Decimal.ROUND_UP);
    case "NEAREST_10P":
      return roundToIncrement(value, new D("0.10"));
    case "NEAREST_50P":
      return roundToIncrement(value, new D("0.50"));
  }
}

function roundToIncrement(value: Decimal, increment: Decimal): Decimal {
  return value
    .dividedBy(increment)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .times(increment)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Round to pence. Used for every figure a customer sees and for every
 * settlement line item.
 */
export function money(value: Decimal): Decimal {
  const rounded = value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  // decimal.js preserves signed zero, so negating a zero commission line would
  // otherwise render as "-0.00" in the settlement matrix.
  return rounded.isZero() ? new D(0) : rounded;
}

/** Round to the 4dp used for odds and rates. */
export function rate(value: Decimal): Decimal {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/**
 * Serialise a decimal for transport. Always a string — a JSON number would
 * reintroduce the floating-point error the whole engine exists to avoid.
 */
export function toMoneyString(value: Decimal): string {
  return money(value).toFixed(2);
}

export function toRateString(value: Decimal): string {
  return rate(value).toFixed(4);
}

export function dec(value: Decimal | string | number): Decimal {
  return new D(value);
}

/**
 * Parse untrusted text into a Decimal without throwing.
 *
 * decimal.js throws on a malformed string, which would defeat the engine's
 * promise to return typed errors rather than raise. Anything unparseable
 * becomes NaN, which every validator already rejects with a proper message.
 */
export function parseDecimal(value: string | number | Decimal | null | undefined): Decimal {
  if (value === null || value === undefined) return new D(NaN);
  if (typeof value === "object") return value;
  const text = String(value).trim().replace(/^£/, "").replace(/,/g, "");
  if (text === "") return new D(NaN);
  try {
    return new D(text);
  } catch {
    return new D(NaN);
  }
}

export function sum(values: Decimal[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new D(0));
}

export function minOf(a: Decimal, b: Decimal): Decimal {
  return a.lessThan(b) ? a : b;
}

export function maxOf(a: Decimal, b: Decimal): Decimal {
  return a.greaterThan(b) ? a : b;
}
