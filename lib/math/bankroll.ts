import { D, ZERO, money, sum, maxOf, type Decimal } from "./decimal";
import type { BankrollRequirement, HedgeResult, TokenPlanMode } from "./types";

/**
 * A buffer over the strict minimum. Lays fill at worse prices than the screen
 * showed, and an exchange that runs out of balance mid-sequence strands you
 * holding an unhedged back bet — the one position matched betting exists to
 * avoid.
 */
export const DEFAULT_BUFFER_RATE = new D("0.20");

export function bankrollRequirement(
  legs: HedgeResult[],
  mode: TokenPlanMode,
  bufferRate: Decimal = DEFAULT_BUFFER_RATE,
): BankrollRequirement {
  const liabilities = legs.map((leg) => leg.exchangeCapitalRequired);
  const stakes = legs.map((leg) => leg.bookmakerCapitalRequired);

  const exchangeBalance =
    mode === "CONCURRENT"
      ? sum(liabilities)
      : liabilities.reduce<Decimal>((acc, v) => maxOf(acc, v), ZERO);

  const bookmakerBalance =
    mode === "CONCURRENT"
      ? sum(stakes)
      : stakes.reduce<Decimal>((acc, v) => maxOf(acc, v), ZERO);

  const total = exchangeBalance.plus(bookmakerBalance);
  const peakLiability = liabilities.reduce<Decimal>((acc, v) => maxOf(acc, v), ZERO);

  return {
    exchangeBalance: money(exchangeBalance),
    bookmakerBalance: money(bookmakerBalance),
    total: money(total),
    bufferRate,
    recommendedTotal: money(total.times(bufferRate.plus(1))),
    peakLiability: money(peakLiability),
  };
}

/** Can this bankroll support the plan? A plain yes/no with the shortfall. */
export function bankrollShortfall(
  requirement: BankrollRequirement,
  availableExchange: Decimal,
  availableBookmaker: Decimal,
): { sufficient: boolean; exchangeShortfall: Decimal; bookmakerShortfall: Decimal } {
  const exchangeShortfall = maxOf(requirement.exchangeBalance.minus(availableExchange), ZERO);
  const bookmakerShortfall = maxOf(requirement.bookmakerBalance.minus(availableBookmaker), ZERO);
  return {
    sufficient: exchangeShortfall.isZero() && bookmakerShortfall.isZero(),
    exchangeShortfall: money(exchangeShortfall),
    bookmakerShortfall: money(bookmakerShortfall),
  };
}
