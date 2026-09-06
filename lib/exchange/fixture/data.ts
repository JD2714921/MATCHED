import { D, type Decimal } from "@/lib/math";
import { stepPrice, toValidPrice } from "../ticks";
import type { PriceLevel } from "../types";

/**
 * Sample exchange data.
 *
 * This is NOT market data. It is a labelled fixture set so the product can be
 * run, demonstrated and tested with no network. Everything that surfaces it is
 * required to say so — see FixtureExchangeProvider.healthCheck().
 *
 * Fixtures are invented, as are the operators elsewhere in the seed.
 */

export interface FixtureSelection {
  id: string;
  name: string;
  /** Best price available to LAY. The book is generated around it. */
  layPrice: string;
  /** Total stake sitting on the best lay price. */
  depth: string;
}

export interface FixtureMarket {
  id: string;
  name: string;
  marketType: string;
  totalMatched: string;
  selections: FixtureSelection[];
}

export interface FixtureEvent {
  id: string;
  sportId: string;
  name: string;
  competition: string;
  countryCode: string;
  /** Hours from "now" that the event starts. */
  startsInHours: number;
  markets: FixtureMarket[];
}

export const FIXTURE_SPORTS = [
  { id: "1", name: "Football" },
  { id: "7", name: "Horse Racing" },
  { id: "2", name: "Tennis" },
];

export const FIXTURE_EVENTS: FixtureEvent[] = [
  {
    id: "evt-1001",
    sportId: "1",
    name: "Ashcombe Rovers v Netherfield United",
    competition: "Sample Football League",
    countryCode: "GB",
    startsInHours: 6,
    markets: [
      {
        id: "mkt-1001-mo",
        name: "Match Odds",
        marketType: "MATCH_ODDS",
        totalMatched: "184320.00",
        selections: [
          { id: "sel-1001-h", name: "Ashcombe Rovers", layPrice: "2.42", depth: "1840.00" },
          { id: "sel-1001-d", name: "The Draw", layPrice: "3.55", depth: "1120.00" },
          { id: "sel-1001-a", name: "Netherfield United", layPrice: "3.30", depth: "1460.00" },
        ],
      },
      {
        id: "mkt-1001-ou",
        name: "Over/Under 2.5 Goals",
        marketType: "OVER_UNDER_25",
        totalMatched: "96210.00",
        selections: [
          { id: "sel-1001-o", name: "Over 2.5 Goals", layPrice: "1.94", depth: "2600.00" },
          { id: "sel-1001-u", name: "Under 2.5 Goals", layPrice: "2.08", depth: "2450.00" },
        ],
      },
    ],
  },
  {
    id: "evt-1002",
    sportId: "1",
    name: "Harborough Town v Kestrel Athletic",
    competition: "Sample Football League",
    countryCode: "GB",
    startsInHours: 27,
    markets: [
      {
        id: "mkt-1002-mo",
        name: "Match Odds",
        marketType: "MATCH_ODDS",
        totalMatched: "51840.00",
        selections: [
          { id: "sel-1002-h", name: "Harborough Town", layPrice: "3.20", depth: "640.00" },
          { id: "sel-1002-d", name: "The Draw", layPrice: "3.40", depth: "520.00" },
          { id: "sel-1002-a", name: "Kestrel Athletic", layPrice: "2.34", depth: "880.00" },
        ],
      },
    ],
  },
  {
    id: "evt-1003",
    sportId: "1",
    name: "Marlow Wanderers v Stonebridge City",
    competition: "Sample Cup",
    countryCode: "GB",
    startsInHours: 51,
    markets: [
      {
        id: "mkt-1003-mo",
        name: "Match Odds",
        marketType: "MATCH_ODDS",
        totalMatched: "22400.00",
        selections: [
          { id: "sel-1003-h", name: "Marlow Wanderers", layPrice: "5.20", depth: "310.00" },
          { id: "sel-1003-d", name: "The Draw", layPrice: "4.10", depth: "280.00" },
          { id: "sel-1003-a", name: "Stonebridge City", layPrice: "1.72", depth: "1450.00" },
        ],
      },
    ],
  },
  {
    id: "evt-2001",
    sportId: "7",
    name: "Sample Park 14:20 — Handicap Hurdle",
    competition: "Sample Park",
    countryCode: "GB",
    startsInHours: 3,
    markets: [
      {
        id: "mkt-2001-win",
        name: "To Win",
        marketType: "WIN",
        totalMatched: "78900.00",
        selections: [
          { id: "sel-2001-a", name: "Copperline Lad", layPrice: "3.65", depth: "420.00" },
          { id: "sel-2001-b", name: "Halyard Dancer", layPrice: "4.60", depth: "380.00" },
          { id: "sel-2001-c", name: "Northgate Flyer", layPrice: "6.40", depth: "260.00" },
          { id: "sel-2001-d", name: "Quiet Ambition", layPrice: "11.50", depth: "140.00" },
          { id: "sel-2001-e", name: "Winterbourne", layPrice: "17.00", depth: "95.00" },
        ],
      },
    ],
  },
  {
    id: "evt-2002",
    sportId: "7",
    name: "Sample Downs 16:05 — Novices Chase",
    competition: "Sample Downs",
    countryCode: "GB",
    startsInHours: 5,
    markets: [
      {
        id: "mkt-2002-win",
        name: "To Win",
        marketType: "WIN",
        totalMatched: "31200.00",
        selections: [
          { id: "sel-2002-a", name: "Fenwick Gale", layPrice: "2.60", depth: "610.00" },
          { id: "sel-2002-b", name: "Alder Vale", layPrice: "4.20", depth: "290.00" },
          { id: "sel-2002-c", name: "Priory Rock", layPrice: "7.60", depth: "155.00" },
        ],
      },
    ],
  },
  {
    id: "evt-3001",
    sportId: "2",
    name: "R. Alvery v T. Nakamura",
    competition: "Sample Open",
    countryCode: "GB",
    startsInHours: 20,
    markets: [
      {
        id: "mkt-3001-mo",
        name: "Match Odds",
        marketType: "MATCH_ODDS",
        totalMatched: "44100.00",
        selections: [
          { id: "sel-3001-a", name: "R. Alvery", layPrice: "1.62", depth: "980.00" },
          { id: "sel-3001-b", name: "T. Nakamura", layPrice: "2.56", depth: "760.00" },
        ],
      },
    ],
  },
  {
    id: "evt-3002",
    sportId: "2",
    name: "P. Kaminski v D. Oyelaran",
    competition: "Sample Open",
    countryCode: "GB",
    startsInHours: 44,
    markets: [
      {
        id: "mkt-3002-mo",
        name: "Match Odds",
        marketType: "MATCH_ODDS",
        totalMatched: "12600.00",
        // A deliberately thin book, so the liquidity warnings are exercised.
        selections: [
          { id: "sel-3002-a", name: "P. Kaminski", layPrice: "1.88", depth: "42.00" },
          { id: "sel-3002-b", name: "D. Oyelaran", layPrice: "2.24", depth: "35.00" },
        ],
      },
    ],
  },
  {
    id: "evt-1004",
    sportId: "1",
    name: "Barrowfield v Eastgate Albion",
    competition: "Sample Football League",
    countryCode: "GB",
    startsInHours: 72,
    markets: [
      {
        id: "mkt-1004-mo",
        name: "Match Odds",
        marketType: "MATCH_ODDS",
        totalMatched: "9800.00",
        selections: [
          { id: "sel-1004-h", name: "Barrowfield", layPrice: "2.90", depth: "480.00" },
          { id: "sel-1004-d", name: "The Draw", layPrice: "3.30", depth: "400.00" },
          { id: "sel-1004-a", name: "Eastgate Albion", layPrice: "2.72", depth: "520.00" },
        ],
      },
    ],
  },
];

/**
 * Build a three-deep ladder around a best price.
 *
 * Sizes fall off as the price worsens, which is how a real book looks and what
 * makes partial-fill handling worth testing.
 */
export function buildLayLadder(bestPrice: Decimal, depth: Decimal): PriceLevel[] {
  return [0, 1, 2].map((step) => ({
    price: stepPrice(bestPrice, step),
    size: depth
      .times(step === 0 ? "1" : step === 1 ? "1.8" : "3.1")
      .toDecimalPlaces(2),
  }));
}

/**
 * The back side of the book, one tick better than the lay side and worsening.
 *
 * These are EXCHANGE back prices. They are indicative of what a bookmaker
 * might show and nothing more — there is no bookmaker odds feed in this
 * product, and the UI must never present one of these as a bookmaker price.
 */
export function buildBackLadder(bestLayPrice: Decimal, depth: Decimal): PriceLevel[] {
  return [1, 2, 3].map((step) => ({
    price: stepPrice(bestLayPrice, -step),
    size: depth
      .times(step === 1 ? "0.9" : step === 2 ? "1.6" : "2.8")
      .toDecimalPlaces(2),
  }));
}

export function fixturePrice(value: string): Decimal {
  return toValidPrice(new D(value));
}
