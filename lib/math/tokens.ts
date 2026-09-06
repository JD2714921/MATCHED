import { ZERO, sum, maxOf, type Decimal } from "./decimal";
import type { HedgeInput, HedgeResult, TokenPlan, TokenPlanMode } from "./types";
import { calculateHedge } from "./hedge";
import { ok, err, type EngineResult, type EngineWarning } from "./errors";

/**
 * Plan a set of tokens.
 *
 * The capital question is the one people get wrong. Three £10 tokens do not
 * need three lots of liability if you work through them one at a time — each
 * lay settles before the next is placed, so you need the LARGEST single
 * liability. Place them on three simultaneous fixtures and you need the SUM,
 * because all three are held by the exchange at once.
 */
export function planTokens(
  inputs: HedgeInput[],
  mode: TokenPlanMode,
): EngineResult<TokenPlan> {
  if (inputs.length === 0) {
    return err([
      { code: "EMPTY_PLAN", field: "plan", message: "A plan needs at least one token." },
    ]);
  }

  const legs: HedgeResult[] = [];
  const warnings: EngineWarning[] = [];

  for (const input of inputs) {
    const result = calculateHedge(input);
    if (!result.ok) return result;
    legs.push(result.value);
    warnings.push(...result.warnings);
  }

  const liabilities = legs.map((leg) => leg.exchangeCapitalRequired);
  const bookmakerStakes = legs.map((leg) => leg.bookmakerCapitalRequired);

  const exchangeCapitalRequired =
    mode === "CONCURRENT"
      ? sum(liabilities)
      : liabilities.reduce<Decimal>((acc, v) => maxOf(acc, v), ZERO);

  const bookmakerCapitalRequired =
    mode === "CONCURRENT"
      ? sum(bookmakerStakes)
      : bookmakerStakes.reduce<Decimal>((acc, v) => maxOf(acc, v), ZERO);

  const totalGuaranteedNet = sum(legs.map((leg) => leg.guaranteedNet));
  const totalFaceValue = sum(legs.map((leg) => leg.input.backStake));

  const blendedRating = totalFaceValue.greaterThan(0)
    ? totalGuaranteedNet.dividedBy(totalFaceValue).times(100).toDecimalPlaces(2)
    : ZERO;

  const explanation =
    mode === "SEQUENTIAL"
      ? `Worked through one at a time, so the exchange only ever holds the largest single liability: ${exchangeCapitalRequired.toFixed(2)}.`
      : `Placed at the same time, so the exchange holds every liability at once: ${exchangeCapitalRequired.toFixed(2)}.`;

  return ok(
    {
      mode,
      legs,
      exchangeCapitalRequired,
      bookmakerCapitalRequired,
      totalGuaranteedNet,
      totalFaceValue,
      blendedRating,
      explanation,
    },
    warnings,
  );
}

/** Build N identical token inputs — the common "3 × £10 free bet" shape. */
export function repeatToken(input: HedgeInput, count: number): HedgeInput[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => ({ ...input }));
}

export const DEFAULT_PLAN_MODE: TokenPlanMode = "SEQUENTIAL";
