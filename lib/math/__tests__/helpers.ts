import { expect } from "vitest";
import { D, type Decimal } from "../decimal";
import type { HedgeInput, HedgeResult, OutcomeResult } from "../types";
import type { EngineResult } from "../errors";

export function d(v: string | number): Decimal {
  return new D(v);
}

export function input(overrides: Partial<HedgeInput> = {}): HedgeInput {
  return {
    betType: "QUALIFYING",
    backStake: d("10"),
    backOdds: d("3.20"),
    layOdds: d("3.25"),
    commission: d("0.05"),
    rounding: "NEAREST_PENNY",
    ...overrides,
  };
}

/** Unwrap an EngineResult, failing the test with the validation errors. */
export function unwrap<T>(result: EngineResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `expected ok, got errors: ${result.errors.map((e) => `${e.code}(${e.field})`).join(", ")}`,
    );
  }
  return result.value;
}

export function expectErrors<T>(result: EngineResult<T>): string[] {
  if (result.ok) throw new Error("expected validation errors, got a value");
  return result.errors.map((e) => e.code);
}

export function expectMoney(actual: Decimal, expected: string, label = ""): void {
  expect(actual.toFixed(2), label).toBe(expected);
}

/**
 * The engine's central invariant: an outcome's rounded line items sum EXACTLY
 * to the outcome's net. Asserted on every result produced anywhere in the
 * engine's test suite.
 */
export function assertSettlementIdentity(outcome: OutcomeResult): void {
  let total = d(0);
  for (const line of outcome.lines) {
    // Every line must already be at pence precision — no line may carry hidden
    // decimals that would make the column fail to add up by hand.
    expect(
      line.amount.decimalPlaces(),
      `line "${line.label}" carries more precision than pence`,
    ).toBeLessThanOrEqual(2);
    total = total.plus(line.amount);
  }
  expect(
    total.toFixed(2),
    `settlement lines for ${outcome.outcome} do not sum to its net`,
  ).toBe(outcome.net.toFixed(2));
  expect(total.equals(outcome.net)).toBe(true);
}

export function assertResultInvariants(result: HedgeResult): void {
  assertSettlementIdentity(result.backWins);
  assertSettlementIdentity(result.backLoses);

  const min = result.backWins.net.lessThan(result.backLoses.net)
    ? result.backWins.net
    : result.backLoses.net;
  const max = result.backWins.net.greaterThan(result.backLoses.net)
    ? result.backWins.net
    : result.backLoses.net;

  expect(result.guaranteedNet.equals(min)).toBe(true);
  expect(result.bestCaseNet.equals(max)).toBe(true);
  expect(result.outcomeSpread.equals(max.minus(min))).toBe(true);
  expect(result.outcomeSpread.isNegative()).toBe(false);

  // The stake shown must be placeable: never more than 2dp.
  expect(result.layStake.decimalPlaces()).toBeLessThanOrEqual(2);
  expect(result.liability.decimalPlaces()).toBeLessThanOrEqual(2);

  // Liability must follow from the ROUNDED stake, not the ideal one.
  expect(
    result.liability.equals(result.layStake.times(result.input.layOdds.minus(1)).toDecimalPlaces(2)),
  ).toBe(true);
}
