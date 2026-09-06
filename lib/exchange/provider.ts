import type {
  CommissionInfo,
  EventQuery,
  ExchangeEvent,
  HealthStatus,
  Market,
  MarketPrices,
  Selection,
  SelectionLiquidity,
  Sport,
} from "./types";

/**
 * What MATCHED needs from an exchange.
 *
 * Betfair is provider one, not the architecture. Every method here is a READ.
 * There is no place/cancel/amend anywhere in the interface, because the
 * platform never places a bet — the customer does, in their own account.
 */
export interface ExchangeProvider {
  readonly name: string;

  getSports(): Promise<Sport[]>;
  getEvents(query: EventQuery): Promise<ExchangeEvent[]>;
  getMarkets(eventId: string): Promise<Market[]>;
  getSelections(marketId: string): Promise<Selection[]>;
  getPrices(marketIds: string[]): Promise<MarketPrices[]>;
  getLiquidity(marketId: string, selectionId: string): Promise<SelectionLiquidity>;
  getCommission(): Promise<CommissionInfo>;
  healthCheck(): Promise<HealthStatus>;
}

export class ExchangeError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "ExchangeError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Method names that must never appear on a provider.
 *
 * Checked at runtime by a test that walks the prototype chain, because a
 * TypeScript interface disappears at compile time and would not stop anyone.
 */
export const FORBIDDEN_METHOD_PATTERNS = [
  /place/i,
  /cancel/i,
  /replace/i,
  /update.*order/i,
  /order/i,
  /bet(?!fair)/i,
  /wager/i,
  /stake.*submit/i,
  /withdraw/i,
  /deposit/i,
  /transfer/i,
];

/** Collect every callable property name on an object and its prototype chain. */
export function surfaceMethodNames(target: object): string[] {
  const names = new Set<string>();
  let current: object | null = target;
  while (current && current !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(current)) {
      if (key === "constructor") continue;
      names.add(key);
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return [...names];
}
