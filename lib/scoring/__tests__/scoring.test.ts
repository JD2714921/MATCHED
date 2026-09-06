import { describe, it, expect } from "vitest";
import { D, assessLiquidity, type LadderLevel } from "@/lib/math";
import {
  COMPONENT_WEIGHTS,
  bandFor,
  scoreOpportunity,
  type ScoringInput,
} from "../index";

const NOW = new Date("2026-03-01T12:00:00.000Z");

const AMPLE_BOOK: LadderLevel[] = [
  { price: new D("3.25"), size: new D("2000") },
  { price: new D("3.30"), size: new D("3000") },
];

function input(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    betType: "FREE_BET_SNR",
    rating: new D("80.00"),
    outcomeSpread: new D("0.01"),
    liquidity: assessLiquidity(AMPLE_BOOK, new D("3.25"), new D("100")),
    totalCapitalRequired: new D("100.00"),
    availableCapital: new D("1000.00"),
    eventStartsAt: new Date(NOW.getTime() + 6 * 3_600_000),
    now: NOW,
    tokenExpiresAt: null,
    termsConfidence: 0.95,
    accountState: "OPEN",
    ...overrides,
  };
}

describe("the total is nothing but the weighted sum", () => {
  it("sums the contributions exactly", () => {
    const score = scoreOpportunity(input());
    const summed = score.components.reduce((total, c) => total + c.contribution, 0);
    expect(score.total).toBeCloseTo(summed, 6);
  });

  it("shows each contribution as weight × score, rounded so the column adds up", () => {
    for (const component of scoreOpportunity(input()).components) {
      // Displayed to 2dp, like every other figure in the product, and the
      // total is the sum of these displayed values rather than of hidden ones.
      expect(Math.abs(component.contribution - component.weight * component.score)).toBeLessThan(
        0.005,
      );
      expect(component.contribution).toBe(Math.round(component.contribution * 100) / 100);
    }
  });

  it("uses weights that sum to one", () => {
    const total = Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it("reports every component with a weight and a reason", () => {
    const score = scoreOpportunity(input());
    expect(score.components).toHaveLength(7);
    for (const component of score.components) {
      expect(component.weight).toBeGreaterThan(0);
      expect(component.reason.length).toBeGreaterThan(10);
      expect(component.score).toBeGreaterThanOrEqual(0);
      expect(component.score).toBeLessThanOrEqual(100);
    }
  });

  it("scores a perfect opportunity at 100 and a hopeless one at 0", () => {
    const best = scoreOpportunity(
      input({
        rating: new D("95.00"),
        outcomeSpread: new D("0"),
        totalCapitalRequired: new D("1.00"),
        termsConfidence: 1,
      }),
    );
    expect(best.total).toBe(100);
    expect(best.band).toBe("STRONG");

    const worst = scoreOpportunity(
      input({
        rating: new D("10.00"),
        outcomeSpread: new D("5.00"),
        liquidity: assessLiquidity([], new D("3.25"), new D("100")),
        totalCapitalRequired: new D("5000.00"),
        availableCapital: new D("100.00"),
        eventStartsAt: new Date(NOW.getTime() - 3_600_000),
        termsConfidence: 0,
        accountState: "OFFER_USED",
      }),
    );
    expect(worst.total).toBe(0);
    expect(worst.band).toBe("WEAK");
  });
});

describe("value", () => {
  it("rewards a token that converts well", () => {
    const high = scoreOpportunity(input({ rating: new D("85.00") }));
    const low = scoreOpportunity(input({ rating: new D("55.00") }));
    const highValue = high.components.find((c) => c.key === "value")!;
    expect(highValue.score).toBe(100);
    expect(highValue.reason).toContain("85.00%");
    expect(low.components.find((c) => c.key === "value")!.score).toBeLessThan(20);
  });

  it("rates a qualifying bet by what qualifying costs, not by the same scale", () => {
    // 99% retained = a 1% qualifying loss = as good as it gets.
    const cheap = scoreOpportunity(input({ betType: "QUALIFYING", rating: new D("99.00") }));
    const value = cheap.components.find((c) => c.key === "value")!;
    expect(value.score).toBe(100);
    expect(value.reason).toContain("1.00% of your stake");

    // The same 99 on the free-bet scale would be off the top; the point is
    // that a 92% qualifying bet is mediocre while a 92% token is excellent.
    const dear = scoreOpportunity(input({ betType: "QUALIFYING", rating: new D("92.00") }));
    expect(dear.components.find((c) => c.key === "value")!.score).toBeLessThan(20);
    const token = scoreOpportunity(input({ betType: "FREE_BET_SNR", rating: new D("92.00") }));
    expect(token.components.find((c) => c.key === "value")!.score).toBe(100);
  });
});

describe("liquidity, capital and timing", () => {
  it("takes the liquidity assessment's own reason verbatim", () => {
    const thin = assessLiquidity(
      [{ price: new D("3.25"), size: new D("10") }],
      new D("3.25"),
      new D("100"),
    );
    const score = scoreOpportunity(input({ liquidity: thin }));
    const component = score.components.find((c) => c.key === "liquidity")!;
    expect(component.score).toBe(25);
    expect(component.reason).toBe(thin.reason);
  });

  it("penalises an opportunity that needs more capital than is available", () => {
    const score = scoreOpportunity(
      input({ totalCapitalRequired: new D("500"), availableCapital: new D("200") }),
    );
    const capital = score.components.find((c) => c.key === "capital")!;
    expect(capital.score).toBe(0);
    expect(capital.reason).toContain("more than you have");
  });

  it("stays neutral, and says why, when balances are unknown", () => {
    const score = scoreOpportunity(input({ availableCapital: null }));
    const capital = score.components.find((c) => c.key === "capital")!;
    expect(capital.score).toBe(60);
    expect(capital.reason).toContain("Tell us your balances");
  });

  it("marks an event that starts after the token expires as unusable", () => {
    const score = scoreOpportunity(
      input({
        eventStartsAt: new Date(NOW.getTime() + 10 * 24 * 3_600_000),
        tokenExpiresAt: new Date(NOW.getTime() + 2 * 24 * 3_600_000),
      }),
    );
    const timing = score.components.find((c) => c.key === "timing")!;
    expect(timing.score).toBe(0);
    expect(timing.reason).toContain("expires before this event");
  });

  it("prefers events that settle soon but not within the hour", () => {
    const soon = scoreOpportunity(input({ eventStartsAt: new Date(NOW.getTime() + 30 * 60_000) }));
    const good = scoreOpportunity(input({ eventStartsAt: new Date(NOW.getTime() + 6 * 3_600_000) }));
    const far = scoreOpportunity(
      input({ eventStartsAt: new Date(NOW.getTime() + 14 * 24 * 3_600_000) }),
    );
    expect(soon.components.find((c) => c.key === "timing")!.score).toBe(40);
    expect(good.components.find((c) => c.key === "timing")!.score).toBe(100);
    expect(far.components.find((c) => c.key === "timing")!.score).toBe(40);
  });

  it("scores a started event at zero", () => {
    const score = scoreOpportunity(
      input({ eventStartsAt: new Date(NOW.getTime() - 60_000) }),
    );
    expect(score.components.find((c) => c.key === "timing")!.reason).toContain("already started");
  });
});

describe("terms confidence and account state", () => {
  it("carries the interpretation's confidence straight into the score", () => {
    const score = scoreOpportunity(input({ termsConfidence: 0.4 }));
    const component = score.components.find((c) => c.key === "termsConfidence")!;
    expect(component.score).toBe(40);
    expect(component.reason).toContain("could not be read");
  });

  it("tells the customer to read the terms themselves when nothing was read", () => {
    const score = scoreOpportunity(input({ termsConfidence: 0 }));
    expect(score.components.find((c) => c.key === "termsConfidence")!.reason).toContain(
      "Read them yourself",
    );
  });

  it("zeroes an offer the customer has already used", () => {
    const score = scoreOpportunity(input({ accountState: "OFFER_USED" }));
    const component = score.components.find((c) => c.key === "accountState")!;
    expect(component.score).toBe(0);
    expect(component.reason).toContain("already used");
  });

  it("does not punish an account that simply is not open yet", () => {
    const score = scoreOpportunity(input({ accountState: "NOT_OPENED" }));
    expect(score.components.find((c) => c.key === "accountState")!.score).toBe(60);
  });
});

describe("headline and bands", () => {
  it("refuses to call an unplaceable opportunity good, however well it scores", () => {
    // Six strong components would otherwise outvote the one that makes the
    // bet impossible: with nothing to lay against, the weighted average is
    // above 80 while the position simply cannot be placed.
    const score = scoreOpportunity(
      input({
        rating: new D("85.00"),
        liquidity: assessLiquidity([], new D("3.25"), new D("100")),
      }),
    );
    expect(score.actionable).toBe(false);
    expect(score.blockers).toHaveLength(1);
    expect(score.band).toBe("WEAK");
    expect(score.total).toBeLessThanOrEqual(35);
    expect(score.headline).toContain("Cannot be placed");
  });

  it("blocks on a started event, a used offer, or a position bigger than the balance", () => {
    const started = scoreOpportunity(
      input({ eventStartsAt: new Date(NOW.getTime() - 60_000) }),
    );
    expect(started.actionable).toBe(false);

    const used = scoreOpportunity(input({ accountState: "OFFER_USED" }));
    expect(used.actionable).toBe(false);

    const broke = scoreOpportunity(
      input({ totalCapitalRequired: new D("500"), availableCapital: new D("100") }),
    );
    expect(broke.actionable).toBe(false);
  });

  it("does not block on merely poor terms or a thin margin", () => {
    // These are judgements for the customer, not impossibilities.
    const score = scoreOpportunity(input({ termsConfidence: 0, rating: new D("51.00") }));
    expect(score.actionable).toBe(true);
    expect(score.blockers).toEqual([]);
  });

  it("names the value when a poor rating drags harder than a thin book", () => {
    // value carries twice liquidity's weight, so a 60% conversion (0.30 × 71.4
    // of damage) outweighs a thin book (0.15 × 75). The headline names
    // whichever actually costs more, not whichever scores lowest.
    const thin = assessLiquidity(
      [{ price: new D("3.25"), size: new D("10") }],
      new D("3.25"),
      new D("100"),
    );
    const score = scoreOpportunity(input({ rating: new D("60.00"), liquidity: thin }));
    expect(score.actionable).toBe(true);
    expect(score.headline.toLowerCase()).toContain("calculated value");
  });

  it("says so when everything lines up", () => {
    const score = scoreOpportunity(
      input({ rating: new D("90.00"), outcomeSpread: new D("0"), termsConfidence: 1 }),
    );
    expect(score.headline).toContain("Everything lines up");
  });

  it("bands on the documented thresholds", () => {
    expect(bandFor(80)).toBe("STRONG");
    expect(bandFor(79.99)).toBe("GOOD");
    expect(bandFor(65)).toBe("GOOD");
    expect(bandFor(64.99)).toBe("FAIR");
    expect(bandFor(45)).toBe("FAIR");
    expect(bandFor(44.99)).toBe("WEAK");
  });
});
