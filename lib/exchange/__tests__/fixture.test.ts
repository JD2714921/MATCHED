import { describe, it, expect } from "vitest";
import { D, assessLiquidity, matchLayStake } from "@/lib/math";
import { FixtureExchangeProvider, fixtureProviderAt } from "../fixture/provider";
import { BetfairExchangeProvider } from "../betfair/provider";
import { BetfairClient } from "../betfair/client";
import { tickSize, toValidPrice, stepPrice } from "../ticks";

const AT = new Date("2026-03-01T12:00:00.000Z");

describe("fixture provider", () => {
  const provider = fixtureProviderAt(AT);

  it("never claims to be live", async () => {
    const health = await provider.healthCheck();
    expect(health.live).toBe(false);
    expect(health.ok).toBe(true);
    expect(health.message).toContain("Sample data");
    expect(health.message).toContain("No exchange has been contacted");
  });

  it("lists sports with their event counts", async () => {
    const sports = await provider.getSports();
    expect(sports.map((s) => s.name)).toEqual(["Football", "Horse Racing", "Tennis"]);
    expect(sports[0]!.eventCount).toBeGreaterThan(0);
  });

  it("returns events in start order", async () => {
    const events = await provider.getEvents({});
    const times = events.map((e) => e.startsAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("filters events by sport, search and time window", async () => {
    expect((await provider.getEvents({ sportId: "7" })).every((e) => e.sportId === "7")).toBe(true);

    const searched = await provider.getEvents({ search: "kestrel" });
    expect(searched).toHaveLength(1);
    expect(searched[0]!.name).toContain("Kestrel");

    const soon = await provider.getEvents({
      to: new Date(AT.getTime() + 8 * 3_600_000),
    });
    expect(soon.length).toBeGreaterThan(0);
    expect(soon.every((e) => e.startsAt.getTime() <= AT.getTime() + 8 * 3_600_000)).toBe(true);
  });

  it("returns a lay ladder that gets more expensive as it goes deeper", async () => {
    const liquidity = await provider.getLiquidity("mkt-1001-mo", "sel-1001-h");
    const prices = liquidity.layLadder.map((l) => l.price);
    expect(prices[0]!.lessThan(prices[1]!)).toBe(true);
    expect(prices[1]!.lessThan(prices[2]!)).toBe(true);
    // Sizes grow with depth, as a real book does.
    expect(liquidity.layLadder[2]!.size.greaterThan(liquidity.layLadder[0]!.size)).toBe(true);
  });

  it("produces ladders the engine can consume directly", async () => {
    const liquidity = await provider.getLiquidity("mkt-1001-mo", "sel-1001-h");
    const target = liquidity.layLadder[1]!.price;
    const match = matchLayStake(liquidity.layLadder, target, new D("100"));
    if (!match.ok) throw new Error("ladder rejected by the engine");
    expect(match.value.fullyMatched).toBe(true);
    expect(match.value.averagePrice).not.toBeNull();
  });

  it("includes a deliberately thin book so shortfalls are exercised", async () => {
    const liquidity = await provider.getLiquidity("mkt-3002-mo", "sel-3002-a");
    const best = liquidity.layLadder[0]!;
    const assessment = assessLiquidity(liquidity.layLadder, best.price, new D("500"));
    expect(assessment.level).toBe("THIN");
  });

  it("puts the best back price below the best lay price", async () => {
    const [prices] = await provider.getPrices(["mkt-1001-mo"]);
    const selection = prices!.selections[0]!;
    expect(selection.availableToBack[0]!.price.lessThan(selection.availableToLay[0]!.price)).toBe(
      true,
    );
  });

  it("reports every market and selection referenced by its fixtures", async () => {
    const events = await provider.getEvents({});
    for (const event of events) {
      const markets = await provider.getMarkets(event.id);
      expect(markets.length).toBeGreaterThan(0);
      for (const market of markets) {
        const selections = await provider.getSelections(market.id);
        expect(selections.length).toBe(market.selectionCount);
        const [prices] = await provider.getPrices([market.id]);
        expect(prices!.selections.map((s) => s.selectionId).sort()).toEqual(
          selections.map((s) => s.id).sort(),
        );
      }
    }
  });

  it("raises a typed error for an unknown market", async () => {
    await expect(provider.getMarkets("evt-nope")).rejects.toThrow(/No sample event/);
    await expect(provider.getSelections("mkt-nope")).rejects.toThrow(/No sample market/);
  });

  it("moves events forward with the clock", async () => {
    const later = fixtureProviderAt(new Date(AT.getTime() + 3_600_000));
    const [a] = await provider.getEvents({});
    const [b] = await later.getEvents({});
    expect(b!.startsAt.getTime() - a!.startsAt.getTime()).toBe(3_600_000);
  });

  it("defaults its clock to now", async () => {
    const live = new FixtureExchangeProvider();
    const [event] = await live.getEvents({});
    expect(event!.startsAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("delayed application key", () => {
  /** A client stub so the provider's mapping can be tested with no network. */
  function stubClient(book: unknown): BetfairClient {
    return {
      call: async () => book,
      listMarketBook: async () => book,
      login: async () => undefined,
      hasSession: true,
      keyIsDelayed: true,
    } as unknown as BetfairClient;
  }

  const credentials = {
    appKey: "k",
    username: "u",
    password: "p",
    certPath: "/dev/null",
    keyPath: "/dev/null",
    keyIsDelayed: true,
  };

  it("reports traded volume as unavailable rather than estimating it", async () => {
    const provider = new BetfairExchangeProvider(credentials, stubClient([]));
    expect(provider.tradedVolumeAvailable).toBe(false);
  });

  it("returns null totalMatched on a delayed key, never zero", async () => {
    const book = [
      {
        marketId: "1.1",
        isMarketDataDelayed: true,
        runners: [
          {
            selectionId: 111,
            totalMatched: 5000,
            lastPriceTraded: 3.2,
            ex: {
              availableToBack: [{ price: 3.15, size: 100 }],
              availableToLay: [{ price: 3.25, size: 120 }],
            },
          },
        ],
      },
    ];
    const provider = new BetfairExchangeProvider(credentials, stubClient(book));
    const [prices] = await provider.getPrices(["1.1"]);
    // Betfair sent a figure, but the key does not license it — so we do not
    // pass it on. Null means "not available on this key".
    expect(prices!.selections[0]!.totalMatched).toBeNull();
    expect(prices!.tradedVolumeAvailable).toBe(false);
  });

  it("carries Betfair's own delay flag through to the response", async () => {
    const book = [{ marketId: "1.1", isMarketDataDelayed: true, runners: [] }];
    const provider = new BetfairExchangeProvider(credentials, stubClient(book));
    const [prices] = await provider.getPrices(["1.1"]);
    expect(prices!.isMarketDataDelayed).toBe(true);
  });

  it("passes traded volume through on a live key", async () => {
    const book = [
      {
        marketId: "1.1",
        isMarketDataDelayed: false,
        runners: [{ selectionId: 111, totalMatched: 5000, ex: {} }],
      },
    ];
    const provider = new BetfairExchangeProvider(
      { ...credentials, keyIsDelayed: false },
      stubClient(book),
    );
    const [prices] = await provider.getPrices(["1.1"]);
    expect(prices!.selections[0]!.totalMatched!.toFixed(2)).toBe("5000.00");
    expect(prices!.isMarketDataDelayed).toBe(false);
  });

  it("says plainly that it cannot read the account's commission rate", async () => {
    const provider = new BetfairExchangeProvider(credentials, stubClient([]));
    const commission = await provider.getCommission();
    expect(commission.basis).toBe("PROVIDER_DEFAULT");
    expect(commission.note).toContain("does not publish your commission rate");
  });

  it("converts JSON floats to Decimal through their string form", async () => {
    const book = [
      {
        marketId: "1.1",
        runners: [
          { selectionId: 1, ex: { availableToLay: [{ price: 1.05, size: 0.1 + 0.2 }] } },
        ],
      },
    ];
    const provider = new BetfairExchangeProvider(credentials, stubClient(book));
    const liquidity = await provider.getLiquidity("1.1", "1");
    // 0.1 + 0.2 is 0.30000000000000004 as a float. Whatever arrives is
    // converted exactly, without a second rounding error being introduced.
    expect(liquidity.layLadder[0]!.size.toString()).toBe("0.30000000000000004");
    expect(liquidity.layLadder[0]!.price.toFixed(2)).toBe("1.05");
  });
});

describe("price ladder ticks", () => {
  it("uses Betfair's increments band by band", () => {
    expect(tickSize(new D("1.50")).toString()).toBe("0.01");
    expect(tickSize(new D("2.50")).toString()).toBe("0.02");
    expect(tickSize(new D("3.50")).toString()).toBe("0.05");
    expect(tickSize(new D("5.00")).toString()).toBe("0.1");
    expect(tickSize(new D("8.00")).toString()).toBe("0.2");
    expect(tickSize(new D("15.00")).toString()).toBe("0.5");
    expect(tickSize(new D("25.00")).toString()).toBe("1");
    expect(tickSize(new D("40.00")).toString()).toBe("2");
    expect(tickSize(new D("75.00")).toString()).toBe("5");
    expect(tickSize(new D("500")).toString()).toBe("10");
  });

  it("snaps an arbitrary price onto a real ladder step", () => {
    expect(toValidPrice(new D("3.23")).toFixed(2)).toBe("3.25");
    expect(toValidPrice(new D("1.234")).toFixed(2)).toBe("1.23");
  });

  it("clamps to the exchange's range", () => {
    expect(toValidPrice(new D("0.5")).toFixed(2)).toBe("1.01");
    expect(toValidPrice(new D("5000")).toFixed(2)).toBe("1000.00");
  });

  it("steps up and down the ladder", () => {
    expect(stepPrice(new D("3.20"), 1).toFixed(2)).toBe("3.25");
    expect(stepPrice(new D("3.20"), -1).toFixed(2)).toBe("3.15");
    expect(stepPrice(new D("1.99"), 1).toFixed(2)).toBe("2.00");
    // Crossing a band boundary uses the band the price lands in.
    expect(stepPrice(new D("2.00"), 1).toFixed(2)).toBe("2.02");
  });
});
