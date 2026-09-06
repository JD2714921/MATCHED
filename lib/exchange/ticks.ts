import { D, type Decimal } from "@/lib/math";

/**
 * Betfair's price ladder increments. Exchange prices only exist on these
 * steps, so a calculated "ideal" lay price must be moved to a real one before
 * it is shown as something to place.
 */
const TICK_BANDS: Array<{ upTo: Decimal; step: Decimal }> = [
  { upTo: new D("2"), step: new D("0.01") },
  { upTo: new D("3"), step: new D("0.02") },
  { upTo: new D("4"), step: new D("0.05") },
  { upTo: new D("6"), step: new D("0.1") },
  { upTo: new D("10"), step: new D("0.2") },
  { upTo: new D("20"), step: new D("0.5") },
  { upTo: new D("30"), step: new D("1") },
  { upTo: new D("50"), step: new D("2") },
  { upTo: new D("100"), step: new D("5") },
  { upTo: new D("1000"), step: new D("10") },
];

export function tickSize(price: Decimal): Decimal {
  for (const band of TICK_BANDS) {
    if (price.lessThan(band.upTo)) return band.step;
  }
  return new D("10");
}

/** Snap a price to the nearest valid ladder step. */
export function toValidPrice(price: Decimal): Decimal {
  const step = tickSize(price);
  const snapped = price.dividedBy(step).toDecimalPlaces(0).times(step);
  if (snapped.lessThan("1.01")) return new D("1.01");
  if (snapped.greaterThan("1000")) return new D("1000");
  return snapped.toDecimalPlaces(2);
}

/** Move a price `steps` ticks up (positive) or down (negative). */
export function stepPrice(price: Decimal, steps: number): Decimal {
  let current = toValidPrice(price);
  const direction = steps >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(steps); i += 1) {
    const step = direction > 0 ? tickSize(current) : tickSize(current.minus("0.001"));
    current = toValidPrice(current.plus(step.times(direction)));
  }
  return current;
}
