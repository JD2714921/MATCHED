import { D } from "@/lib/math";
import { childLogger } from "@/lib/logger";
import type { ExchangeProvider } from "../provider";
import { ExchangeError } from "../provider";
import type {
  CommissionInfo,
  EventQuery,
  ExchangeEvent,
  HealthStatus,
  Market,
  MarketPrices,
  PriceLevel,
  Selection,
  SelectionLiquidity,
  SelectionPrices,
  Sport,
} from "../types";
import { BetfairClient, type BetfairCredentials } from "./client";

const log = childLogger("betfair-provider");

export const BETFAIR_PROVIDER_NAME = "betfair";

// --- Shapes of the Betfair responses we consume -----------------------------

interface BfEventTypeResult {
  eventType: { id: string; name: string };
  marketCount: number;
}

interface BfEventResult {
  event: {
    id: string;
    name: string;
    countryCode?: string;
    openDate: string;
  };
  marketCount: number;
}

interface BfMarketCatalogue {
  marketId: string;
  marketName: string;
  marketStartTime: string;
  totalMatched?: number;
  description?: { marketType?: string };
  event?: { id: string };
  runners?: Array<{ selectionId: number; runnerName: string; handicap?: number }>;
}

interface BfPriceSize {
  price: number;
  size: number;
}

interface BfRunnerBook {
  selectionId: number;
  handicap?: number;
  lastPriceTraded?: number;
  totalMatched?: number;
  ex?: {
    availableToBack?: BfPriceSize[];
    availableToLay?: BfPriceSize[];
  };
}

interface BfMarketBook {
  marketId: string;
  isMarketDataDelayed?: boolean;
  totalMatched?: number;
  runners?: BfRunnerBook[];
}

/**
 * Betfair as an ExchangeProvider.
 *
 * IMPORTANT — this class has NOT been verified against the live service. The
 * environment it was written in cannot reach api.betfair.com or
 * identitysso-cert.betfair.com: the egress proxy refuses the CONNECT tunnel
 * with a 403. Everything below is written to Betfair's documented contract and
 * is exercised against recorded response shapes in tests, which is not the
 * same thing as working. See docs/betfair-integration.md and
 * `npm run verify:betfair`.
 */
export class BetfairExchangeProvider implements ExchangeProvider {
  readonly name = BETFAIR_PROVIDER_NAME;

  readonly #client: BetfairClient;
  readonly #keyIsDelayed: boolean;
  /** Selection names are only in the catalogue, so cache what we have seen. */
  readonly #selectionNames = new Map<string, string>();
  readonly #marketNames = new Map<string, string>();

  constructor(credentials: BetfairCredentials, client?: BetfairClient) {
    this.#client = client ?? new BetfairClient(credentials);
    this.#keyIsDelayed = credentials.keyIsDelayed;
  }

  /**
   * A delayed key returns no traded volume at all. We report that rather than
   * estimating it — an estimated volume presented as a fact would be exactly
   * the kind of invented figure this product exists to avoid.
   */
  get tradedVolumeAvailable(): boolean {
    return !this.#keyIsDelayed;
  }

  async getSports(): Promise<Sport[]> {
    const results = await this.#client.call<BfEventTypeResult[]>("listEventTypes", {
      filter: {},
    });
    return results.map((r) => ({
      id: r.eventType.id,
      name: r.eventType.name,
      eventCount: r.marketCount ?? null,
    }));
  }

  async getEvents(query: EventQuery = {}): Promise<ExchangeEvent[]> {
    const filter: Record<string, unknown> = {};
    if (query.sportId) filter.eventTypeIds = [query.sportId];
    if (query.search) filter.textQuery = query.search;
    if (query.from || query.to) {
      filter.marketStartTime = {
        ...(query.from ? { from: query.from.toISOString() } : {}),
        ...(query.to ? { to: query.to.toISOString() } : {}),
      };
    }

    const results = await this.#client.call<BfEventResult[]>("listEvents", { filter });
    const events = results.map((r) => ({
      id: r.event.id,
      sportId: query.sportId ?? "",
      name: r.event.name,
      competition: null,
      startsAt: new Date(r.event.openDate),
      countryCode: r.event.countryCode ?? null,
    }));
    return query.limit ? events.slice(0, query.limit) : events;
  }

  async getMarkets(eventId: string): Promise<Market[]> {
    const results = await this.#client.call<BfMarketCatalogue[]>("listMarketCatalogue", {
      filter: { eventIds: [eventId] },
      marketProjection: ["MARKET_START_TIME", "MARKET_DESCRIPTION", "RUNNER_DESCRIPTION", "EVENT"],
      maxResults: 100,
    });

    for (const market of results) this.#cacheCatalogue(market);

    return results.map((market) => ({
      id: market.marketId,
      eventId: market.event?.id ?? eventId,
      name: market.marketName,
      marketType: market.description?.marketType ?? "UNKNOWN",
      startsAt: new Date(market.marketStartTime),
      // Absent on a delayed key; reported as unknown rather than as zero.
      totalMatched:
        this.tradedVolumeAvailable && market.totalMatched !== undefined
          ? new D(market.totalMatched.toString())
          : null,
      selectionCount: market.runners?.length ?? 0,
    }));
  }

  async getSelections(marketId: string): Promise<Selection[]> {
    const results = await this.#client.call<BfMarketCatalogue[]>("listMarketCatalogue", {
      filter: { marketIds: [marketId] },
      marketProjection: ["RUNNER_DESCRIPTION"],
      maxResults: 1,
    });

    const market = results[0];
    if (!market) throw new ExchangeError("MARKET_NOT_FOUND", `Betfair has no market ${marketId}.`);
    this.#cacheCatalogue(market);

    return (market.runners ?? []).map((runner) => ({
      id: String(runner.selectionId),
      marketId,
      name: runner.runnerName,
      handicap: runner.handicap === undefined ? null : new D(runner.handicap.toString()),
    }));
  }

  async getPrices(marketIds: string[]): Promise<MarketPrices[]> {
    if (marketIds.length === 0) return [];

    // Ensure names are available before prices are shaped; a price with no
    // selection name is unusable in the UI.
    await this.#ensureCatalogue(marketIds);

    const books = await this.#client.listMarketBook<BfMarketBook>(marketIds, [
      "EX_BEST_OFFERS",
    ]);

    const capturedAt = new Date();
    return books.map((book) => ({
      marketId: book.marketId,
      marketName: this.#marketNames.get(book.marketId) ?? book.marketId,
      // Betfair's own flag, carried straight through. Never inferred.
      isMarketDataDelayed: book.isMarketDataDelayed ?? this.#keyIsDelayed,
      tradedVolumeAvailable: this.tradedVolumeAvailable,
      selections: (book.runners ?? []).map((runner) => this.#toSelectionPrices(runner)),
      capturedAt,
    }));
  }

  async getLiquidity(marketId: string, selectionId: string): Promise<SelectionLiquidity> {
    const [book] = await this.#client.listMarketBook<BfMarketBook>([marketId], [
      "EX_BEST_OFFERS",
    ]);
    if (!book) throw new ExchangeError("MARKET_NOT_FOUND", `Betfair has no market ${marketId}.`);

    const runner = (book.runners ?? []).find((r) => String(r.selectionId) === selectionId);
    if (!runner) {
      throw new ExchangeError(
        "SELECTION_NOT_FOUND",
        `Betfair has no selection ${selectionId} in ${marketId}.`,
      );
    }

    return {
      marketId,
      selectionId,
      layLadder: toLadder(runner.ex?.availableToLay),
      backLadder: toLadder(runner.ex?.availableToBack),
      isMarketDataDelayed: book.isMarketDataDelayed ?? this.#keyIsDelayed,
      tradedVolumeAvailable: this.tradedVolumeAvailable,
      capturedAt: new Date(),
    };
  }

  async getCommission(): Promise<CommissionInfo> {
    // Betfair's rate is account-specific and is NOT exposed by the betting
    // API, so it cannot be read. Saying so is better than assuming 5% and
    // presenting it as the customer's rate.
    return {
      rate: new D("0.05"),
      basis: "PROVIDER_DEFAULT",
      note:
        "Betfair does not publish your commission rate through this API. 5% is the standard base rate — check your own account and change it if it differs.",
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    const startedAt = Date.now();
    try {
      await this.#client.call<BfEventTypeResult[]>("listEventTypes", { filter: {} });
      return {
        provider: this.name,
        ok: true,
        latencyMs: Date.now() - startedAt,
        message: this.#keyIsDelayed
          ? "Connected on a DELAYED application key: prices are snapshot-delayed and traded volume is not available."
          : "Connected.",
        dataDelayed: this.#keyIsDelayed,
        tradedVolumeAvailable: this.tradedVolumeAvailable,
        checkedAt: new Date(),
        live: true,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      log.warn({ err: message }, "betfair health check failed");
      return {
        provider: this.name,
        ok: false,
        latencyMs: Date.now() - startedAt,
        message,
        dataDelayed: this.#keyIsDelayed,
        tradedVolumeAvailable: this.tradedVolumeAvailable,
        checkedAt: new Date(),
        live: false,
      };
    }
  }

  #toSelectionPrices(runner: BfRunnerBook): SelectionPrices {
    const id = String(runner.selectionId);
    return {
      selectionId: id,
      selectionName: this.#selectionNames.get(id) ?? id,
      availableToBack: toLadder(runner.ex?.availableToBack),
      availableToLay: toLadder(runner.ex?.availableToLay),
      lastPriceTraded:
        runner.lastPriceTraded === undefined ? null : new D(runner.lastPriceTraded.toString()),
      // Null, not zero: a delayed key genuinely does not tell us this.
      totalMatched:
        this.tradedVolumeAvailable && runner.totalMatched !== undefined
          ? new D(runner.totalMatched.toString())
          : null,
    };
  }

  #cacheCatalogue(market: BfMarketCatalogue): void {
    this.#marketNames.set(market.marketId, market.marketName);
    for (const runner of market.runners ?? []) {
      this.#selectionNames.set(String(runner.selectionId), runner.runnerName);
    }
  }

  async #ensureCatalogue(marketIds: string[]): Promise<void> {
    const missing = marketIds.filter((id) => !this.#marketNames.has(id));
    if (missing.length === 0) return;
    const results = await this.#client.call<BfMarketCatalogue[]>("listMarketCatalogue", {
      filter: { marketIds: missing },
      marketProjection: ["RUNNER_DESCRIPTION"],
      maxResults: Math.max(1, missing.length),
    });
    for (const market of results) this.#cacheCatalogue(market);
  }
}

/**
 * Betfair reports `availableToLay` as the prices and sizes you can LAY at,
 * where `size` is the stake you would place. That is already our convention,
 * so the mapping is a straight numeric conversion.
 *
 * Numbers arrive from JSON as JS floats and are converted to Decimal via their
 * string form immediately, before any arithmetic touches them.
 */
function toLadder(levels: BfPriceSize[] | undefined): PriceLevel[] {
  return (levels ?? []).map((level) => ({
    price: new D(level.price.toString()),
    size: new D(level.size.toString()),
  }));
}
