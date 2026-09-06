import { D } from "@/lib/math";
import type { ExchangeProvider } from "../provider";
import { ExchangeError } from "../provider";
import type {
  CommissionInfo,
  EventQuery,
  ExchangeEvent,
  HealthStatus,
  Market,
  MarketPrices,
  Selection,
  SelectionLiquidity,
  SelectionPrices,
  Sport,
} from "../types";
import {
  FIXTURE_EVENTS,
  FIXTURE_SPORTS,
  buildBackLadder,
  buildLayLadder,
  fixturePrice,
  type FixtureEvent,
  type FixtureMarket,
} from "./data";

export const FIXTURE_PROVIDER_NAME = "fixture";

/**
 * An offline exchange built on labelled sample data.
 *
 * This exists so the whole product can be run and tested without a network,
 * and so nothing is ever tempted to fake a live integration to get a screen
 * working. Its health check reports `live: false` and says plainly what it is.
 */
export class FixtureExchangeProvider implements ExchangeProvider {
  readonly name = FIXTURE_PROVIDER_NAME;

  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  async getSports(): Promise<Sport[]> {
    return FIXTURE_SPORTS.map((sport) => ({
      id: sport.id,
      name: sport.name,
      eventCount: FIXTURE_EVENTS.filter((e) => e.sportId === sport.id).length,
    }));
  }

  async getEvents(query: EventQuery = {}): Promise<ExchangeEvent[]> {
    const events = FIXTURE_EVENTS.filter((event) => {
      if (query.sportId && event.sportId !== query.sportId) return false;
      const startsAt = this.#startsAt(event);
      if (query.from && startsAt < query.from) return false;
      if (query.to && startsAt > query.to) return false;
      if (query.search) {
        const needle = query.search.toLowerCase();
        const haystack = `${event.name} ${event.competition}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    })
      .map((event) => ({
        id: event.id,
        sportId: event.sportId,
        name: event.name,
        competition: event.competition,
        startsAt: this.#startsAt(event),
        countryCode: event.countryCode,
      }))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    return query.limit ? events.slice(0, query.limit) : events;
  }

  async getMarkets(eventId: string): Promise<Market[]> {
    const event = FIXTURE_EVENTS.find((e) => e.id === eventId);
    if (!event) throw new ExchangeError("EVENT_NOT_FOUND", `No sample event ${eventId}.`);
    return event.markets.map((market) => this.#toMarket(event, market));
  }

  async getSelections(marketId: string): Promise<Selection[]> {
    const found = this.#findMarket(marketId);
    return found.market.selections.map((selection) => ({
      id: selection.id,
      marketId,
      name: selection.name,
      handicap: new D(0),
    }));
  }

  async getPrices(marketIds: string[]): Promise<MarketPrices[]> {
    return marketIds.map((marketId) => {
      const { market } = this.#findMarket(marketId);
      const selections: SelectionPrices[] = market.selections.map((selection) => {
        const layPrice = fixturePrice(selection.layPrice);
        const depth = new D(selection.depth);
        return {
          selectionId: selection.id,
          selectionName: selection.name,
          availableToBack: buildBackLadder(layPrice, depth),
          availableToLay: buildLayLadder(layPrice, depth),
          lastPriceTraded: layPrice,
          totalMatched: new D(market.totalMatched),
        };
      });

      return {
        marketId,
        marketName: market.name,
        // Sample data is not delayed because it is not data. Reported honestly
        // rather than mirrored from a live key.
        isMarketDataDelayed: false,
        tradedVolumeAvailable: true,
        selections,
        capturedAt: this.#now(),
      };
    });
  }

  async getLiquidity(marketId: string, selectionId: string): Promise<SelectionLiquidity> {
    const { market } = this.#findMarket(marketId);
    const selection = market.selections.find((s) => s.id === selectionId);
    if (!selection) {
      throw new ExchangeError(
        "SELECTION_NOT_FOUND",
        `No sample selection ${selectionId} in ${marketId}.`,
      );
    }
    const layPrice = fixturePrice(selection.layPrice);
    const depth = new D(selection.depth);
    return {
      marketId,
      selectionId,
      layLadder: buildLayLadder(layPrice, depth),
      backLadder: buildBackLadder(layPrice, depth),
      isMarketDataDelayed: false,
      tradedVolumeAvailable: true,
      capturedAt: this.#now(),
    };
  }

  async getCommission(): Promise<CommissionInfo> {
    return {
      rate: new D("0.05"),
      basis: "PROVIDER_DEFAULT",
      note: "Sample rate of 5%. Enter the rate your own exchange account charges — it varies by account.",
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    return {
      provider: this.name,
      ok: true,
      latencyMs: 0,
      message:
        "Sample data provider. No exchange has been contacted; every price shown is invented and labelled as such.",
      dataDelayed: false,
      tradedVolumeAvailable: true,
      checkedAt: this.#now(),
      live: false,
    };
  }

  #startsAt(event: FixtureEvent): Date {
    return new Date(this.#now().getTime() + event.startsInHours * 3_600_000);
  }

  #toMarket(event: FixtureEvent, market: FixtureMarket): Market {
    return {
      id: market.id,
      eventId: event.id,
      name: market.name,
      marketType: market.marketType,
      startsAt: this.#startsAt(event),
      totalMatched: new D(market.totalMatched),
      selectionCount: market.selections.length,
    };
  }

  #findMarket(marketId: string): { event: FixtureEvent; market: FixtureMarket } {
    for (const event of FIXTURE_EVENTS) {
      const market = event.markets.find((m) => m.id === marketId);
      if (market) return { event, market };
    }
    throw new ExchangeError("MARKET_NOT_FOUND", `No sample market ${marketId}.`);
  }
}

/** Convenience for tests that need a stable clock. */
export function fixtureProviderAt(instant: Date): FixtureExchangeProvider {
  return new FixtureExchangeProvider(() => instant);
}
