import { describe, it, expect } from "vitest";
import { calculateHedge, hedgeFromStrings, idealLayStake } from "../hedge";
import {
  d,
  input,
  unwrap,
  expectErrors,
  expectMoney,
  assertResultInvariants,
} from "./helpers";

/**
 * Every golden figure below was computed by hand from the formulas in the
 * specification and checked independently of the implementation.
 */

describe("qualifying bet", () => {
  it("matches the reference worked example exactly", () => {
    // B=10, b=3.20, l=3.25, c=0.05
    //   S       = 10 * 3.20 / (3.25 - 0.05) = 32 / 3.20 = 10.00 exactly
    //   liab    = 10.00 * 2.25              = 22.50
    //   wins    = 10*(3.20-1) - 22.50       = 22.00 - 22.50 = -0.50
    //   loses   = 10*(1-0.05) - 10          =  9.50 - 10.00 = -0.50
    //   rating  = (10 - 0.50) / 10          = 95.00%
    const result = unwrap(calculateHedge(input()));

    expectMoney(result.layStake, "10.00", "lay stake");
    expectMoney(result.liability, "22.50", "liability");
    expectMoney(result.backWins.net, "-0.50", "net if back wins");
    expectMoney(result.backLoses.net, "-0.50", "net if back loses");
    expectMoney(result.guaranteedNet, "-0.50", "guaranteed net");
    expectMoney(result.outcomeSpread, "0.00", "spread");
    expect(result.rating.toFixed(2)).toBe("95.00");
    expectMoney(result.exchangeCapitalRequired, "22.50");
    expectMoney(result.bookmakerCapitalRequired, "10.00");
    assertResultInvariants(result);
  });

  it("shows the qualifying loss as the cost of the stake, not of the bet", () => {
    const result = unwrap(calculateHedge(input()));
    // Both outcomes leave the customer 50p down: that is the whole point.
    expect(result.backWins.net.equals(result.backLoses.net)).toBe(true);
  });

  it("charges no commission when the exchange rate is zero", () => {
    // B=10, b=3.20, l=3.25, c=0
    //   S     = 32 / 3.25 = 9.8461538... -> 9.85
    //   liab  = 9.85 * 2.25 = 22.1625    -> 22.16
    //   wins  = -10 + 32.00 - 22.16      = -0.16
    //   loses = -10 +  9.85 -  0.00      = -0.15
    const result = unwrap(calculateHedge(input({ commission: d("0") })));

    expectMoney(result.layStake, "9.85");
    expectMoney(result.liability, "22.16");
    expectMoney(result.backWins.net, "-0.16");
    expectMoney(result.backLoses.net, "-0.15");
    expectMoney(result.guaranteedNet, "-0.16");
    expect(result.rating.toFixed(2)).toBe("98.40");
    assertResultInvariants(result);
  });

  it("handles the minimum permitted odds on both sides", () => {
    // B=10, b=1.01, l=1.01, c=0.05
    //   S     = 10.10 / 0.96 = 10.5208333... -> 10.52
    //   liab  = 10.52 * 0.01 = 0.1052        ->  0.11
    //   wins  = -10 + 10.10 - 0.11           = -0.01
    //   loses = -10 + 10.52 - 0.53           = -0.01   (10.52*0.05 = 0.526 -> 0.53)
    const result = unwrap(
      calculateHedge(input({ backOdds: d("1.01"), layOdds: d("1.01") })),
    );
    expectMoney(result.layStake, "10.52");
    expectMoney(result.liability, "0.11");
    expectMoney(result.backWins.net, "-0.01");
    expectMoney(result.backLoses.net, "-0.01");
    assertResultInvariants(result);
  });

  it("handles the maximum permitted odds on both sides", () => {
    // B=10, b=1000, l=1000, c=0.05
    //   S     = 10000 / 999.95 = 10.0005000... -> 10.00
    //   liab  = 10.00 * 999    = 9990.00
    //   wins  = -10 + 10000.00 - 9990.00 = 0.00
    //   loses = -10 + 10.00 - 0.50       = -0.50
    const result = unwrap(
      calculateHedge(input({ backOdds: d("1000"), layOdds: d("1000") })),
    );
    expectMoney(result.layStake, "10.00");
    expectMoney(result.liability, "9990.00");
    expectMoney(result.backWins.net, "0.00");
    expectMoney(result.backLoses.net, "-0.50");
    expectMoney(result.guaranteedNet, "-0.50");
    assertResultInvariants(result);
  });
});

describe("free bet, stake not returned (SNR)", () => {
  it("computes a £30 token at 5.00 / 5.20 by hand", () => {
    // B=30, b=5.00, l=5.20, c=0.05
    //   S     = 30*(5-1) / (5.20-0.05) = 120 / 5.15 = 23.3009708... -> 23.30
    //   liab  = 23.30 * 4.20 = 97.86
    //   wins  = 0 + 120.00 - 97.86 = 22.14
    //   loses = 0 + 23.30 - 1.17   = 22.13   (23.30*0.05 = 1.165 -> 1.17)
    //   rating = 22.13 / 30 = 73.766...% -> 73.77%
    const result = unwrap(
      calculateHedge(
        input({
          betType: "FREE_BET_SNR",
          backStake: d("30"),
          backOdds: d("5.00"),
          layOdds: d("5.20"),
        }),
      ),
    );

    expectMoney(result.layStake, "23.30");
    expectMoney(result.liability, "97.86");
    expectMoney(result.backWins.net, "22.14");
    expectMoney(result.backLoses.net, "22.13");
    expectMoney(result.guaranteedNet, "22.13");
    expectMoney(result.outcomeSpread, "0.01");
    expect(result.rating.toFixed(2)).toBe("73.77");
    // A token costs nothing at the bookmaker.
    expectMoney(result.bookmakerCapitalRequired, "0.00");
    assertResultInvariants(result);
  });

  it("does not return the token's face value when the back bet wins", () => {
    const result = unwrap(
      calculateHedge(input({ betType: "FREE_BET_SNR", backStake: d("10") })),
    );
    // B=10, b=3.20 -> winnings only = 10 * 2.20 = 22.00
    const winningsLine = result.backWins.lines.find((l) => l.venue === "BOOKMAKER");
    expectMoney(winningsLine!.amount, "22.00");
  });
});

describe("free bet, stake returned (SR)", () => {
  it("computes a £10 SR token at 3.20 / 3.25 by hand", () => {
    // B=10, b=3.20, l=3.25, c=0.05
    //   S     = 10*3.20 / 3.20 = 10.00
    //   liab  = 10.00 * 2.25   = 22.50
    //   wins  = 0 + 32.00 - 22.50 = 9.50
    //   loses = 0 + 10.00 -  0.50 = 9.50
    const result = unwrap(calculateHedge(input({ betType: "FREE_BET_SR" })));
    expectMoney(result.layStake, "10.00");
    expectMoney(result.backWins.net, "9.50");
    expectMoney(result.backLoses.net, "9.50");
    expect(result.rating.toFixed(2)).toBe("95.00");
    assertResultInvariants(result);
  });

  it("is worth roughly a quarter of the token more than SNR", () => {
    // SNR at the same prices:
    //   S     = 10*2.20 / 3.20 = 6.875 -> 6.88
    //   liab  = 6.88 * 2.25 = 15.48
    //   wins  = 0 + 22.00 - 15.48 = 6.52
    //   loses = 0 +  6.88 -  0.34 = 6.54   (6.88*0.05 = 0.344 -> 0.34)
    const snr = unwrap(calculateHedge(input({ betType: "FREE_BET_SNR" })));
    const sr = unwrap(calculateHedge(input({ betType: "FREE_BET_SR" })));

    expectMoney(snr.layStake, "6.88");
    expectMoney(snr.guaranteedNet, "6.52");
    expect(snr.rating.toFixed(2)).toBe("65.20");
    expectMoney(sr.guaranteedNet, "9.50");

    // Reading the terms wrongly costs 29.8 points of the token's face value —
    // which is why the parser weights this field most heavily.
    const gap = sr.rating.minus(snr.rating);
    expect(gap.greaterThan(25)).toBe(true);
  });
});

describe("settlement matrix", () => {
  it("adds up by hand for every bet type and both outcomes", () => {
    for (const betType of ["QUALIFYING", "FREE_BET_SNR", "FREE_BET_SR"] as const) {
      for (const commission of ["0", "0.02", "0.05"]) {
        for (const layOdds of ["1.50", "3.25", "7.40", "19.50"]) {
          for (const rounding of [
            "NEAREST_PENNY",
            "NEAREST_10P",
            "NEAREST_50P",
            "DOWN_PENNY",
            "UP_PENNY",
          ] as const) {
            const result = unwrap(
              calculateHedge(
                input({
                  betType,
                  commission: d(commission),
                  layOdds: d(layOdds),
                  backOdds: d("3.20"),
                  rounding,
                }),
              ),
            );
            assertResultInvariants(result);
          }
        }
      }
    }
  });

  it("labels the free bet token as costing nothing", () => {
    const result = unwrap(calculateHedge(input({ betType: "FREE_BET_SNR" })));
    const token = result.backWins.lines.find((l) => l.venue === "NONE");
    expect(token).toBeDefined();
    expect(token!.amount.isZero()).toBe(true);
    expect(token!.note).toContain("costs you nothing");
  });

  it("never renders a negative zero", () => {
    const result = unwrap(calculateHedge(input({ commission: d("0") })));
    for (const line of [...result.backWins.lines, ...result.backLoses.lines]) {
      expect(line.amount.toFixed(2)).not.toBe("-0.00");
    }
  });
});

describe("rounding modes", () => {
  // ideal S at c=0 is 32 / 3.25 = 9.84615384...
  const cases: Array<[string, string]> = [
    ["NEAREST_PENNY", "9.85"],
    ["DOWN_PENNY", "9.84"],
    ["UP_PENNY", "9.85"],
    ["NEAREST_10P", "9.80"],
    ["NEAREST_50P", "10.00"],
  ];

  for (const [mode, expected] of cases) {
    it(`${mode} produces a stake of ${expected}`, () => {
      const result = unwrap(
        calculateHedge(
          input({ commission: d("0"), rounding: mode as never }),
        ),
      );
      expectMoney(result.layStake, expected);
      assertResultInvariants(result);
    });
  }

  it("under-laying leaves you exposed to the back bet losing", () => {
    // DOWN_PENNY -> S = 9.84, liab = 9.84*2.25 = 22.14
    //   wins  = -10 + 32.00 - 22.14 = -0.14
    //   loses = -10 +  9.84 -  0.00 = -0.16
    const result = unwrap(
      calculateHedge(input({ commission: d("0"), rounding: "DOWN_PENNY" })),
    );
    expectMoney(result.backWins.net, "-0.14");
    expectMoney(result.backLoses.net, "-0.16");
    expect(result.guaranteedNet.equals(result.backLoses.net)).toBe(true);
  });

  it("over-laying leaves you exposed to the back bet winning", () => {
    // UP_PENNY at c=0.02: ideal = 32 / 3.23 = 9.9071207... -> 9.91
    //   liab  = 9.91 * 2.25 = 22.2975 -> 22.30
    //   wins  = -10 + 32.00 - 22.30 = -0.30
    //   loses = -10 +  9.91 -  0.20 = -0.29   (9.91*0.02 = 0.1982 -> 0.20)
    const result = unwrap(
      calculateHedge(input({ commission: d("0.02"), rounding: "UP_PENNY" })),
    );
    expectMoney(result.layStake, "9.91");
    expectMoney(result.backWins.net, "-0.30");
    expectMoney(result.backLoses.net, "-0.29");
    expect(result.guaranteedNet.equals(result.backWins.net)).toBe(true);
  });

  it("warns when coarse rounding opens a wide gap between outcomes", () => {
    const result = calculateHedge(input({ rounding: "NEAREST_50P", backStake: d("10") }));
    if (!result.ok) throw new Error("expected ok");
    // Whether it fires depends on the numbers; assert the mechanism, not luck.
    const spread = result.value.outcomeSpread;
    const warned = result.warnings.some((w) => w.code === "LARGE_OUTCOME_SPREAD");
    expect(warned).toBe(spread.greaterThan("0.25"));
  });
});

describe("the ideal stake is reported but never used for outcomes", () => {
  it("keeps the unrounded ideal for transparency", () => {
    const result = unwrap(calculateHedge(input({ commission: d("0") })));
    expect(result.idealLayStake.toFixed(6)).toBe("9.846154");
    expectMoney(result.layStake, "9.85");
  });

  it("computes liability from the rounded stake, not the ideal", () => {
    const result = unwrap(calculateHedge(input({ commission: d("0") })));
    // 9.85 * 2.25 = 22.1625 -> 22.16, NOT 9.846153... * 2.25 = 22.154...
    expectMoney(result.liability, "22.16");
  });

  it("exposes the ideal stake formula directly", () => {
    expect(idealLayStake(input()).toFixed(4)).toBe("10.0000");
  });
});

describe("validation returns typed errors rather than throwing", () => {
  it("rejects odds below the minimum", () => {
    expect(expectErrors(calculateHedge(input({ backOdds: d("1.00") })))).toContain(
      "BACK_ODDS_TOO_LOW",
    );
    expect(expectErrors(calculateHedge(input({ layOdds: d("0.5") })))).toContain(
      "LAY_ODDS_TOO_LOW",
    );
  });

  it("rejects odds above the maximum", () => {
    expect(expectErrors(calculateHedge(input({ backOdds: d("1001") })))).toContain(
      "BACK_ODDS_TOO_HIGH",
    );
    expect(expectErrors(calculateHedge(input({ layOdds: d("5000") })))).toContain(
      "LAY_ODDS_TOO_HIGH",
    );
  });

  it("rejects a non-positive stake", () => {
    expect(expectErrors(calculateHedge(input({ backStake: d("0") })))).toContain(
      "STAKE_NOT_POSITIVE",
    );
    expect(expectErrors(calculateHedge(input({ backStake: d("-5") })))).toContain(
      "STAKE_NOT_POSITIVE",
    );
  });

  it("rejects an impossible commission", () => {
    expect(expectErrors(calculateHedge(input({ commission: d("-0.01") })))).toContain(
      "COMMISSION_NEGATIVE",
    );
    expect(expectErrors(calculateHedge(input({ commission: d("0.9") })))).toContain(
      "COMMISSION_TOO_HIGH",
    );
  });

  it("reports every problem at once so a form can show them together", () => {
    const codes = expectErrors(
      calculateHedge(input({ backStake: d("0"), backOdds: d("1"), commission: d("-1") })),
    );
    expect(codes).toContain("STAKE_NOT_POSITIVE");
    expect(codes).toContain("BACK_ODDS_TOO_LOW");
    expect(codes).toContain("COMMISSION_NEGATIVE");
  });

  it("does not throw on unparseable text", () => {
    const result = hedgeFromStrings({
      betType: "QUALIFYING",
      backStake: "not a number",
      backOdds: "3.20",
      layOdds: "3.25",
      commission: "0.05",
      rounding: "NEAREST_PENNY",
    });
    expect(expectErrors(result)).toContain("STAKE_NOT_FINITE");
  });

  it("accepts money typed the way a person types it", () => {
    const result = unwrap(
      hedgeFromStrings({
        betType: "QUALIFYING",
        backStake: "£1,000",
        backOdds: "3.20",
        layOdds: "3.25",
        commission: "0.05",
        rounding: "NEAREST_PENNY",
      }),
    );
    expectMoney(result.layStake, "1000.00");
  });
});

describe("warnings", () => {
  it("flags a lay price shorter than the back price", () => {
    const result = calculateHedge(input({ backOdds: d("3.40"), layOdds: d("3.20") }));
    if (!result.ok) throw new Error("expected ok");
    expect(result.warnings.map((w) => w.code)).toContain("LAY_SHORTER_THAN_BACK");
  });

  it("flags an exchange price far worse than the bookmaker price", () => {
    const result = calculateHedge(input({ backOdds: d("3.00"), layOdds: d("4.00") }));
    if (!result.ok) throw new Error("expected ok");
    expect(result.warnings.map((w) => w.code)).toContain("EXTREME_ODDS_GAP");
  });

  it("never reports a losing token at penny rounding, because one cannot exist", () => {
    // Algebraically, an SNR token's outcomes are B(b-1)(1-c)/(l-c) and
    // S(1-c) — both strictly positive for every valid input. So the warning
    // must NOT fire here even though the prices are dreadful.
    const result = calculateHedge(
      input({ betType: "FREE_BET_SNR", backOdds: d("1.10"), layOdds: d("4.00") }),
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.guaranteedNet.isNegative()).toBe(false);
    expect(result.warnings.map((w) => w.code)).not.toContain("NEGATIVE_FREE_BET_RETURN");
  });

  it("flags a token that coarse rounding turns into a loss", () => {
    // The only way a token converts to a loss is rounding, and on a small
    // token 50p rounding is enough to do it.
    //   ideal S = 10*(1.10-1) / (4.00-0.05) = 1 / 3.95 = 0.2531... -> 0.50
    //   liab    = 0.50 * 3.00 = 1.50
    //   wins    = 0 + 1.00 - 1.50 = -0.50
    //   loses   = 0 + 0.50 - 0.03 =  0.47   (0.50*0.05 = 0.025 -> 0.03)
    const result = calculateHedge(
      input({
        betType: "FREE_BET_SNR",
        backOdds: d("1.10"),
        layOdds: d("4.00"),
        rounding: "NEAREST_50P",
      }),
    );
    if (!result.ok) throw new Error("expected ok");
    expectMoney(result.value.layStake, "0.50");
    expectMoney(result.value.backWins.net, "-0.50");
    expectMoney(result.value.backLoses.net, "0.47");
    expectMoney(result.value.guaranteedNet, "-0.50");
    expect(result.warnings.map((w) => w.code)).toContain("NEGATIVE_FREE_BET_RETURN");
  });

  it("flags a lay stake below exchange minimums", () => {
    const result = calculateHedge(input({ backStake: d("1") }));
    if (!result.ok) throw new Error("expected ok");
    expect(result.warnings.map((w) => w.code)).toContain("VERY_LOW_STAKE");
  });
});
