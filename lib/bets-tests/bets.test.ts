import { describe, it, expect } from "vitest";
import type { BetLeg } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { legNet, realisedResult, nextStage, stageIndex } from "../bets";

function leg(overrides: Partial<BetLeg>): BetLeg {
  return {
    id: "leg",
    betPlanId: "plan",
    stage: "QUALIFYING",
    side: "BACK",
    betType: "QUALIFYING",
    suggestedStake: new Prisma.Decimal("10.00"),
    suggestedOdds: new Prisma.Decimal("3.2000"),
    actualStake: null,
    actualOdds: null,
    commissionRate: new Prisma.Decimal("0.0500"),
    liability: null,
    venue: "Somewhere",
    outcome: "PENDING",
    returnAmount: null,
    placedAt: null,
    settledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BetLeg;
}

describe("realised results come from what actually happened", () => {
  it("prefers the actual stake and price over the suggestion", () => {
    // Suggested a £10 lay at 3.25; it actually filled at 3.35.
    const filled = leg({
      side: "LAY",
      suggestedStake: new Prisma.Decimal("10.00"),
      suggestedOdds: new Prisma.Decimal("3.2500"),
      actualStake: new Prisma.Decimal("10.00"),
      actualOdds: new Prisma.Decimal("3.3500"),
      outcome: "LOST",
    });
    // Lay lost => you pay liability at the price you actually got:
    // 10.00 * (3.35 - 1) = 23.50, not 22.50.
    expect(legNet(filled)!.toFixed(2)).toBe("-23.50");
  });

  it("falls back to the suggestion only until an actual is recorded", () => {
    const untouched = leg({ side: "BACK", outcome: "WON" });
    // 10 * (3.20 - 1) = 22.00
    expect(legNet(untouched)!.toFixed(2)).toBe("22.00");
    expect(realisedResult([untouched]).usingSuggestions).toBe(true);

    const recorded = leg({
      side: "BACK",
      outcome: "WON",
      actualStake: new Prisma.Decimal("10.00"),
      actualOdds: new Prisma.Decimal("3.1000"),
    });
    expect(legNet(recorded)!.toFixed(2)).toBe("21.00");
    expect(realisedResult([recorded]).usingSuggestions).toBe(false);
  });

  it("settles a winning lay net of commission", () => {
    const won = leg({
      side: "LAY",
      actualStake: new Prisma.Decimal("10.00"),
      actualOdds: new Prisma.Decimal("3.2500"),
      outcome: "WON",
    });
    // 10.00 * (1 - 0.05) = 9.50
    expect(legNet(won)!.toFixed(2)).toBe("9.50");
  });

  it("costs nothing when a free bet loses", () => {
    const lost = leg({ side: "BACK", betType: "FREE_BET_SNR", outcome: "LOST" });
    expect(legNet(lost)!.toFixed(2)).toBe("0.00");
  });

  it("pays winnings only on a won SNR token, and stake too on an SR one", () => {
    const snr = leg({ side: "BACK", betType: "FREE_BET_SNR", outcome: "WON" });
    const sr = leg({ side: "BACK", betType: "FREE_BET_SR", outcome: "WON" });
    expect(legNet(snr)!.toFixed(2)).toBe("22.00");
    expect(legNet(sr)!.toFixed(2)).toBe("32.00");
  });

  it("costs your own stake when a qualifying back bet loses", () => {
    expect(legNet(leg({ side: "BACK", outcome: "LOST" }))!.toFixed(2)).toBe("-10.00");
  });

  it("treats a void leg as costing nothing either way", () => {
    expect(legNet(leg({ side: "BACK", outcome: "VOID" }))!.toFixed(2)).toBe("0.00");
    expect(legNet(leg({ side: "LAY", outcome: "VOID" }))!.toFixed(2)).toBe("0.00");
  });

  it("reports nothing while a leg is still pending", () => {
    expect(legNet(leg({ outcome: "PENDING" }))).toBeNull();
  });
});

describe("a whole position", () => {
  it("adds its legs up once every one has settled", () => {
    // Qualifying at 10 / 3.20 / 3.25, back loses and lay wins.
    const legs = [
      leg({ id: "a", side: "BACK", outcome: "LOST" }),
      leg({
        id: "b",
        side: "LAY",
        suggestedStake: new Prisma.Decimal("10.00"),
        suggestedOdds: new Prisma.Decimal("3.2500"),
        outcome: "WON",
      }),
    ];
    const result = realisedResult(legs);
    expect(result.complete).toBe(true);
    // -10.00 + 9.50 = -0.50, the expected qualifying loss.
    expect(result.net!.toFixed(2)).toBe("-0.50");
  });

  it("withholds a total while any leg is unsettled", () => {
    const result = realisedResult([
      leg({ id: "a", side: "BACK", outcome: "LOST" }),
      leg({ id: "b", side: "LAY", outcome: "PENDING" }),
    ]);
    expect(result.complete).toBe(false);
    expect(result.net).toBeNull();
    expect(result.settledLegs).toBe(1);
    expect(result.totalLegs).toBe(2);
  });

  it("has no total for a position with no legs", () => {
    expect(realisedResult([]).net).toBeNull();
  });
});

describe("stages", () => {
  it("moves forward one step at a time", () => {
    expect(nextStage("PLANNED")).toBe("QUALIFYING_PLACED");
    expect(nextStage("TOKEN_RECEIVED")).toBe("CONVERSION_PLACED");
    expect(nextStage("CONVERSION_PLACED")).toBe("COMPLETED");
  });

  it("stops at completed", () => {
    expect(nextStage("COMPLETED")).toBeNull();
    expect(stageIndex("COMPLETED")).toBe(5);
  });

  it("does not advance an abandoned position", () => {
    expect(nextStage("ABANDONED")).toBeNull();
  });
});
