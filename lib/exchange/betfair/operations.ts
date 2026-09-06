/**
 * The Betfair surface MATCHED is allowed to touch.
 *
 * This is a whitelist, not a blacklist. An operation that is not named here
 * cannot be sent, so a future edit cannot accidentally introduce order
 * placement — it would have to add the operation to this list deliberately, in
 * a file whose whole purpose is to say no.
 */
export const ALLOWED_OPERATIONS = [
  "listEventTypes",
  "listCompetitions",
  "listEvents",
  "listMarketCatalogue",
  "listMarketBook",
  "listMarketTypes",
  "listRunnerBook",
  "listTimeRanges",
  "listVenues",
  "listCountries",
] as const;

export type AllowedOperation = (typeof ALLOWED_OPERATIONS)[number];

/**
 * Operations that must never be sent, listed explicitly so the refusal is
 * legible in a stack trace and in this file rather than implied by absence.
 */
export const REFUSED_OPERATIONS = [
  "placeOrders",
  "cancelOrders",
  "replaceOrders",
  "updateOrders",
  "listCurrentOrders",
  "listClearedOrders",
] as const;

export class ForbiddenOperationError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(
      `Refusing to call Betfair operation "${operation}". MATCHED is read-only: it reads market data and never places, changes or cancels a bet.`,
    );
    this.name = "ForbiddenOperationError";
    this.operation = operation;
  }
}

/**
 * Gate every call. Throws before any socket is opened.
 */
export function assertAllowedOperation(operation: string): asserts operation is AllowedOperation {
  if (!(ALLOWED_OPERATIONS as readonly string[]).includes(operation)) {
    throw new ForbiddenOperationError(operation);
  }
}

export function isAllowedOperation(operation: string): operation is AllowedOperation {
  return (ALLOWED_OPERATIONS as readonly string[]).includes(operation);
}

// ---------------------------------------------------------------------------
// Market data request limits
// ---------------------------------------------------------------------------

/**
 * Betfair weights each price projection, and enforces
 *
 *     sum(weight) * marketCount <= 200
 *
 * per listMarketBook call. Exceeding it earns a TOO_MUCH_DATA error, so the
 * client batches against this rather than discovering the limit in production.
 */
export const PROJECTION_WEIGHTS: Record<string, number> = {
  SP_AVAILABLE: 3,
  SP_TRADED: 7,
  EX_BEST_OFFERS: 5,
  EX_ALL_OFFERS: 17,
  EX_TRADED: 17,
};

export const MAX_REQUEST_WEIGHT = 200;

/**
 * EX_ALL_OFFERS supersedes EX_BEST_OFFERS: asking for both costs 17, not 22.
 */
export function normaliseProjections(projections: string[]): string[] {
  const unique = [...new Set(projections)];
  if (unique.includes("EX_ALL_OFFERS")) {
    return unique.filter((p) => p !== "EX_BEST_OFFERS");
  }
  return unique;
}

export function projectionWeight(projections: string[]): number {
  return normaliseProjections(projections).reduce((total, projection) => {
    const weight = PROJECTION_WEIGHTS[projection];
    if (weight === undefined) {
      throw new Error(`Unknown Betfair price projection "${projection}".`);
    }
    return total + weight;
  }, 0);
}

/**
 * How many markets may be asked for in one call.
 *
 * With EX_BEST_OFFERS alone this is 200 / 5 = 40, the familiar figure.
 */
export function maxMarketsPerCall(projections: string[]): number {
  const weight = projectionWeight(projections);
  if (weight <= 0) return MAX_REQUEST_WEIGHT;
  return Math.max(1, Math.floor(MAX_REQUEST_WEIGHT / weight));
}

/** Split market ids into batches that each satisfy the weight limit. */
export function batchMarketIds(marketIds: string[], projections: string[]): string[][] {
  const size = maxMarketsPerCall(projections);
  const batches: string[][] = [];
  for (let i = 0; i < marketIds.length; i += size) {
    batches.push(marketIds.slice(i, i + size));
  }
  return batches;
}
