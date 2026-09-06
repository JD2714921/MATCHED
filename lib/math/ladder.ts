import { D, ZERO, money, sum, type Decimal } from "./decimal";
import type { LadderLevel, LiquidityAssessment, MatchFill, MatchResult } from "./types";
import { ok, err, type EngineResult } from "./errors";
import { validateLadder } from "./validate";

/**
 * Sort a lay ladder best-first.
 *
 * "Best" for someone placing a LAY bet means the LOWEST price: laying at 3.20
 * costs you £2.20 of liability per pound, laying at 3.40 costs £2.40. So the
 * front of the queue is the smallest price.
 */
export function sortLayLadder(levels: LadderLevel[]): LadderLevel[] {
  return [...levels].sort((a, b) => a.price.comparedTo(b.price));
}

/**
 * Cumulative stake matchable at or better than `targetPrice`.
 *
 * This is the whole reason partial matching needs its own function: it is NOT
 * the size sitting at the target price. Every level priced BELOW the target is
 * also available to you, and is better than what you asked for.
 */
export function depthAtOrBetter(levels: LadderLevel[], targetPrice: Decimal): Decimal {
  return sum(
    levels.filter((l) => l.price.lessThanOrEqualTo(targetPrice)).map((l) => l.size),
  );
}

/**
 * Walk the ladder filling `desiredStake` at prices at or better than target.
 */
export function matchLayStake(
  levels: LadderLevel[],
  targetPrice: Decimal,
  desiredStake: Decimal,
): EngineResult<MatchResult> {
  const errors = validateLadder(levels);
  if (errors.length > 0) return err(errors);

  const sorted = sortLayLadder(levels).filter((l) =>
    l.price.lessThanOrEqualTo(targetPrice),
  );

  const fills: MatchFill[] = [];
  let remaining = desiredStake;

  for (const level of sorted) {
    if (remaining.lessThanOrEqualTo(0)) break;
    if (level.size.lessThanOrEqualTo(0)) continue;
    const take = remaining.lessThan(level.size) ? remaining : level.size;
    fills.push({ price: level.price, size: money(take) });
    remaining = remaining.minus(take);
  }

  const matched = sum(fills.map((f) => f.size));
  const unmatched = money(desiredStake.minus(matched));

  // Volume-weighted average of the prices actually consumed. This — not the
  // target — is the price the outcome figures should be recomputed at when a
  // fill is partial.
  const averagePrice = matched.greaterThan(0)
    ? sum(fills.map((f) => f.price.times(f.size))).dividedBy(matched).toDecimalPlaces(4)
    : null;

  return ok({
    matched: money(matched),
    unmatched: unmatched.isNegative() ? ZERO : unmatched,
    fills,
    averagePrice,
    fullyMatched: unmatched.lessThanOrEqualTo(0),
  });
}

const AMPLE_COVERAGE = new D("3");
const SUFFICIENT_COVERAGE = new D("1");
const COVERAGE_DISPLAY_CAP = new D("99");

export function assessLiquidity(
  levels: LadderLevel[],
  targetPrice: Decimal,
  requiredStake: Decimal,
): LiquidityAssessment {
  const depth = depthAtOrBetter(levels, targetPrice);

  if (depth.lessThanOrEqualTo(0)) {
    return {
      depthAtOrBetter: ZERO,
      requiredStake,
      coverage: ZERO,
      level: "EMPTY",
      reason: `Nothing is offered at ${targetPrice.toFixed(2)} or better.`,
    };
  }

  if (requiredStake.lessThanOrEqualTo(0)) {
    return {
      depthAtOrBetter: money(depth),
      requiredStake,
      coverage: COVERAGE_DISPLAY_CAP,
      level: "AMPLE",
      reason: "No stake required.",
    };
  }

  const rawCoverage = depth.dividedBy(requiredStake);
  const coverage = (rawCoverage.greaterThan(COVERAGE_DISPLAY_CAP)
    ? COVERAGE_DISPLAY_CAP
    : rawCoverage
  ).toDecimalPlaces(2);

  let level: LiquidityAssessment["level"];
  let reason: string;
  if (rawCoverage.greaterThanOrEqualTo(AMPLE_COVERAGE)) {
    level = "AMPLE";
    reason = `${money(depth).toFixed(2)} available — comfortably more than the ${money(requiredStake).toFixed(2)} needed.`;
  } else if (rawCoverage.greaterThanOrEqualTo(SUFFICIENT_COVERAGE)) {
    level = "SUFFICIENT";
    reason = `${money(depth).toFixed(2)} available against ${money(requiredStake).toFixed(2)} needed. Enough, with little to spare.`;
  } else {
    level = "THIN";
    reason = `Only ${money(depth).toFixed(2)} available against ${money(requiredStake).toFixed(2)} needed. Part of your lay would go unmatched.`;
  }

  return { depthAtOrBetter: money(depth), requiredStake, coverage, level, reason };
}

/** Best (lowest) price with any size on it, or null for an empty book. */
export function bestLayPrice(levels: LadderLevel[]): Decimal | null {
  const withSize = sortLayLadder(levels).filter((l) => l.size.greaterThan(0));
  return withSize[0]?.price ?? null;
}

/** Best (highest) available back price on the exchange, or null. */
export function bestBackPrice(levels: LadderLevel[]): Decimal | null {
  const withSize = [...levels]
    .filter((l) => l.size.greaterThan(0))
    .sort((a, b) => b.price.comparedTo(a.price));
  return withSize[0]?.price ?? null;
}
