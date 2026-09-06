import { describe, it, expect } from "vitest";
import {
  assessLiquidity,
  bestBackPrice,
  bestLayPrice,
  depthAtOrBetter,
  matchLayStake,
  sortLayLadder,
} from "../ladder";
import type { LadderLevel } from "../types";
import { d, unwrap, expectErrors, expectMoney } from "./helpers";

function ladder(levels: Array<[string, string]>): LadderLevel[] {
  return levels.map(([price, size]) => ({ price: d(price), size: d(size) }));
}

// A representative lay book. Deliberately supplied out of order so the tests
// prove the sorting rather than the fixture.
const BOOK = ladder([
  ["3.30", "200"],
  ["3.20", "50"],
  ["3.40", "500"],
  ["3.25", "100"],
]);

describe("lay ladder ordering", () => {
  it("puts the lowest price first, because laying lower is better", () => {
    expect(sortLayLadder(BOOK).map((l) => l.price.toFixed(2))).toEqual([
      "3.20",
      "3.25",
      "3.30",
      "3.40",
    ]);
  });

  it("reports the best lay price as the lowest with size on it", () => {
    expect(bestLayPrice(BOOK)!.toFixed(2)).toBe("3.20");
  });

  it("ignores levels with no size when finding the best price", () => {
    const withHole = ladder([["3.10", "0"], ["3.20", "50"]]);
    expect(bestLayPrice(withHole)!.toFixed(2)).toBe("3.20");
  });

  it("reports the best back price as the highest with size on it", () => {
    expect(bestBackPrice(BOOK)!.toFixed(2)).toBe("3.40");
  });

  it("returns null for an empty book", () => {
    expect(bestLayPrice([])).toBeNull();
    expect(bestBackPrice([])).toBeNull();
  });
});

describe("depth at or better", () => {
  it("counts every level priced at or below the target, not just the target", () => {
    // 3.20 (50) + 3.25 (100) = 150. This is the rule people get wrong: a price
    // BELOW your target is better than what you asked for, so it counts.
    expectMoney(depthAtOrBetter(BOOK, d("3.25")), "150.00");
  });

  it("counts the whole book when the target is above every level", () => {
    expectMoney(depthAtOrBetter(BOOK, d("3.40")), "850.00");
  });

  it("counts nothing when the target is below every level", () => {
    expectMoney(depthAtOrBetter(BOOK, d("3.10")), "0.00");
  });
});

describe("partial matching", () => {
  it("fills across levels and reports the price actually achieved", () => {
    // Want 120 at 3.25 or better: 50 @ 3.20 then 70 @ 3.25.
    // VWAP = (3.20*50 + 3.25*70) / 120 = 387.50 / 120 = 3.229166... -> 3.2292
    const result = unwrap(matchLayStake(BOOK, d("3.25"), d("120")));
    expectMoney(result.matched, "120.00");
    expectMoney(result.unmatched, "0.00");
    expect(result.fullyMatched).toBe(true);
    expect(result.fills.map((f) => [f.price.toFixed(2), f.size.toFixed(2)])).toEqual([
      ["3.20", "50.00"],
      ["3.25", "70.00"],
    ]);
    expect(result.averagePrice!.toFixed(4)).toBe("3.2292");
  });

  it("reports the shortfall when the book cannot cover the stake", () => {
    // Want 200 at 3.25 or better, only 150 is there.
    // VWAP = (3.20*50 + 3.25*100) / 150 = 485 / 150 = 3.23333... -> 3.2333
    const result = unwrap(matchLayStake(BOOK, d("3.25"), d("200")));
    expectMoney(result.matched, "150.00");
    expectMoney(result.unmatched, "50.00");
    expect(result.fullyMatched).toBe(false);
    expect(result.averagePrice!.toFixed(4)).toBe("3.2333");
  });

  it("matches nothing against an empty book", () => {
    const result = unwrap(matchLayStake([], d("3.25"), d("100")));
    expectMoney(result.matched, "0.00");
    expectMoney(result.unmatched, "100.00");
    expect(result.fills).toEqual([]);
    expect(result.averagePrice).toBeNull();
    expect(result.fullyMatched).toBe(false);
  });

  it("matches nothing when every price is worse than the target", () => {
    const result = unwrap(matchLayStake(BOOK, d("3.10"), d("100")));
    expectMoney(result.matched, "0.00");
    expect(result.averagePrice).toBeNull();
  });

  it("stops at the first level when it alone covers the stake", () => {
    const result = unwrap(matchLayStake(BOOK, d("3.40"), d("20")));
    expect(result.fills).toHaveLength(1);
    expect(result.averagePrice!.toFixed(4)).toBe("3.2000");
  });

  it("rejects a malformed ladder rather than silently mis-filling", () => {
    expect(expectErrors(matchLayStake(ladder([["3.20", "-5"]]), d("3.25"), d("10")))).toContain(
      "LADDER_SIZE_NEGATIVE",
    );
    expect(expectErrors(matchLayStake(ladder([["0.5", "10"]]), d("3.25"), d("10")))).toContain(
      "LADDER_PRICE_INVALID",
    );
  });
});

describe("liquidity assessment", () => {
  it("calls three times cover ample", () => {
    const a = assessLiquidity(BOOK, d("3.25"), d("50"));
    expect(a.level).toBe("AMPLE");
    expect(a.coverage.toFixed(2)).toBe("3.00");
  });

  it("calls between one and three times cover sufficient", () => {
    const a = assessLiquidity(BOOK, d("3.25"), d("100"));
    expect(a.level).toBe("SUFFICIENT");
    expect(a.coverage.toFixed(2)).toBe("1.50");
  });

  it("calls less than full cover thin, and says how short it is", () => {
    const a = assessLiquidity(BOOK, d("3.25"), d("300"));
    expect(a.level).toBe("THIN");
    expect(a.coverage.toFixed(2)).toBe("0.50");
    expect(a.reason).toContain("150.00");
    expect(a.reason).toContain("unmatched");
  });

  it("calls an unavailable price empty", () => {
    const a = assessLiquidity(BOOK, d("3.10"), d("50"));
    expect(a.level).toBe("EMPTY");
    expectMoney(a.depthAtOrBetter, "0.00");
    expect(a.reason).toContain("3.10");
  });

  it("caps the coverage figure so the UI never shows an absurd multiple", () => {
    const a = assessLiquidity(BOOK, d("3.40"), d("0.01"));
    expect(a.coverage.toFixed(2)).toBe("99.00");
    expect(a.level).toBe("AMPLE");
  });
});
