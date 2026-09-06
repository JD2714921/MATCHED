import type { Decimal } from "@/lib/math";

export interface Sport {
  id: string;
  name: string;
  eventCount: number | null;
}

export interface ExchangeEvent {
  id: string;
  sportId: string;
  name: string;
  competition: string | null;
  startsAt: Date;
  countryCode: string | null;
}

export interface Market {
  id: string;
  eventId: string;
  name: string;
  /** e.g. "MATCH_ODDS", "OVER_UNDER_25". */
  marketType: string;
  startsAt: Date;
  /** Total matched, when the key permits it. Null on a delayed key. */
  totalMatched: Decimal | null;
  selectionCount: number;
}

export interface Selection {
  id: string;
  marketId: string;
  name: string;
  /** Betfair's handicap field; zero for most markets. */
  handicap: Decimal | null;
}

export interface PriceLevel {
  price: Decimal;
  /**
   * Stake matchable at this price, expressed as the stake YOU would place.
   * Each provider is responsible for translating its own convention into this
   * one so the engine's ladder functions can be used unchanged.
   */
  size: Decimal;
}

export interface SelectionPrices {
  selectionId: string;
  selectionName: string;
  /**
   * Prices you could BACK at on the exchange. Used only as an INDICATIVE
   * starting point for what a bookmaker might be showing — never as a
   * bookmaker price. There is no bookmaker odds feed in this product.
   */
  availableToBack: PriceLevel[];
  /** Prices you could LAY at. This is the side the hedge is placed on. */
  availableToLay: PriceLevel[];
  lastPriceTraded: Decimal | null;
  /** Null when the application key does not provide traded volume. */
  totalMatched: Decimal | null;
}

export interface MarketPrices {
  marketId: string;
  marketName: string;
  /**
   * Carried through from the exchange's own flag — never inferred, never
   * defaulted to false. Surfaced as a badge on every price in the UI.
   */
  isMarketDataDelayed: boolean;
  /**
   * False on a DELAYED application key. When false, traded volume is reported
   * as unavailable rather than estimated.
   */
  tradedVolumeAvailable: boolean;
  selections: SelectionPrices[];
  capturedAt: Date;
}

export interface SelectionLiquidity {
  marketId: string;
  selectionId: string;
  layLadder: PriceLevel[];
  backLadder: PriceLevel[];
  isMarketDataDelayed: boolean;
  tradedVolumeAvailable: boolean;
  capturedAt: Date;
}

export interface CommissionInfo {
  /** Base rate, e.g. 0.05 for 5%. */
  rate: Decimal;
  /** Where the figure came from — a published default, or the account's own. */
  basis: "PROVIDER_DEFAULT" | "ACCOUNT_SPECIFIC" | "CUSTOMER_SUPPLIED";
  note: string;
}

export interface HealthStatus {
  provider: string;
  ok: boolean;
  latencyMs: number | null;
  message: string;
  /** Whether this provider's data is delayed. */
  dataDelayed: boolean;
  tradedVolumeAvailable: boolean;
  checkedAt: Date;
  /**
   * True only when the provider has genuinely spoken to a live service.
   * The fixture provider reports false, so nothing can mistake sample data
   * for a working integration.
   */
  live: boolean;
}

export interface EventQuery {
  sportId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  /** Free-text match against event and competition names. */
  search?: string;
}
