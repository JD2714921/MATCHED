import { describe, it, expect } from "vitest";
import { reprice } from "../repricing";
import { planTokens, repeatToken } from "../tokens";
import { bankrollRequirement, bankrollShortfall } from "../bankroll";
import { calculateHedge } from "../hedge";
import { d, input, unwrap, expectErrors, expectMoney } from "./helpers";

describe("repricing", () => {
  const original = unwrap(calculateHedge(input()));

  it("calls a small drift immaterial", () => {
    // l 3.25 -> 3.26: S = 32/3.21 = 9.9688... -> 9.97, guaranteed -0.53
    // vs -0.50 originally: a 3p move, under the 10p threshold.
    const r = unwrap(reprice(original, d("3.26")));
    expectMoney(r.current.layStake, "9.97");
    expectMoney(r.guaranteedNetDelta, "-0.03");
    expect(r.materialChange).toBe(false);
    expect(r.reason).toContain("not enough");
  });

  it("calls a move against you material and says so", () => {
    // l 3.25 -> 3.30: S = 32/3.25 = 9.8461... -> 9.85
    //   liab  = 9.85 * 2.30 = 22.655 -> 22.66
    //   wins  = -10 + 32.00 - 22.66 = -0.66
    //   loses = -10 +  9.85 -  0.49 = -0.64   (9.85*0.05 = 0.4925 -> 0.49)
    const r = unwrap(reprice(original, d("3.30")));
    expectMoney(r.current.layStake, "9.85");
    expectMoney(r.current.liability, "22.66");
    expectMoney(r.current.guaranteedNet, "-0.66");
    expectMoney(r.guaranteedNetDelta, "-0.16");
    expectMoney(r.layStakeDelta, "-0.15");
    expect(r.materialChange).toBe(true);
    expect(r.reason).toContain("against you");
  });

  it("recognises a move in your favour", () => {
    const r = unwrap(reprice(original, d("3.10")));
    expect(r.materialChange).toBe(true);
    expect(r.guaranteedNetDelta.isPositive()).toBe(true);
    expect(r.reason).toContain("in your favour");
  });

  it("passes validation errors through instead of throwing", () => {
    expect(expectErrors(reprice(original, d("0.5")))).toContain("LAY_ODDS_TOO_LOW");
  });

  it("honours a caller-supplied threshold", () => {
    const strict = unwrap(reprice(original, d("3.26"), { stake: d("0.01"), net: d("0.01") }));
    expect(strict.materialChange).toBe(true);
  });
});

describe("multi-token planning", () => {
  // Three £10 SNR tokens at 3.20 / 3.25 / 5%:
  //   each: S = 6.88, liability 15.48, guaranteed 6.52
  const token = input({ betType: "FREE_BET_SNR" });

  it("needs only the largest single liability when worked one at a time", () => {
    const plan = unwrap(planTokens(repeatToken(token, 3), "SEQUENTIAL"));
    expectMoney(plan.exchangeCapitalRequired, "15.48");
    expectMoney(plan.totalGuaranteedNet, "19.56");
    expectMoney(plan.totalFaceValue, "30.00");
    expect(plan.blendedRating.toFixed(2)).toBe("65.20");
    expect(plan.explanation).toContain("largest single liability");
  });

  it("needs every liability at once when they run concurrently", () => {
    const plan = unwrap(planTokens(repeatToken(token, 3), "CONCURRENT"));
    // 15.48 * 3 = 46.44
    expectMoney(plan.exchangeCapitalRequired, "46.44");
    // The return is identical — only the capital differs.
    expectMoney(plan.totalGuaranteedNet, "19.56");
  });

  it("takes the largest liability, not the first, when tokens differ", () => {
    const plan = unwrap(
      planTokens(
        [
          input({ betType: "FREE_BET_SNR", backStake: d("10") }),
          input({ betType: "FREE_BET_SNR", backStake: d("50") }),
          input({ betType: "FREE_BET_SNR", backStake: d("20") }),
        ],
        "SEQUENTIAL",
      ),
    );
    // £50 token: S = 50*2.20/3.20 = 34.375 -> 34.38, liab = 34.38*2.25 = 77.355 -> 77.36
    expectMoney(plan.exchangeCapitalRequired, "77.36");
  });

  it("counts bookmaker stakes too when the legs are qualifying bets", () => {
    const plan = unwrap(planTokens(repeatToken(input(), 3), "CONCURRENT"));
    expectMoney(plan.bookmakerCapitalRequired, "30.00");
    const sequential = unwrap(planTokens(repeatToken(input(), 3), "SEQUENTIAL"));
    expectMoney(sequential.bookmakerCapitalRequired, "10.00");
  });

  it("rejects an empty plan", () => {
    expect(expectErrors(planTokens([], "SEQUENTIAL"))).toContain("EMPTY_PLAN");
  });

  it("propagates a validation error from any single leg", () => {
    expect(
      expectErrors(planTokens([input(), input({ backOdds: d("1") })], "SEQUENTIAL")),
    ).toContain("BACK_ODDS_TOO_LOW");
  });
});

describe("bankroll requirements", () => {
  const legs = repeatToken(input({ betType: "FREE_BET_SNR" }), 3).map((t) =>
    unwrap(calculateHedge(t)),
  );

  it("sizes the exchange balance from the peak liability when sequential", () => {
    const req = bankrollRequirement(legs, "SEQUENTIAL");
    expectMoney(req.exchangeBalance, "15.48");
    expectMoney(req.bookmakerBalance, "0.00");
    expectMoney(req.total, "15.48");
    // 15.48 * 1.20 = 18.576 -> 18.58
    expectMoney(req.recommendedTotal, "18.58");
    expectMoney(req.peakLiability, "15.48");
  });

  it("sizes it from the sum when concurrent", () => {
    const req = bankrollRequirement(legs, "CONCURRENT");
    expectMoney(req.exchangeBalance, "46.44");
    // peak liability is still a single leg's — it is a different question
    expectMoney(req.peakLiability, "15.48");
  });

  it("reports a shortfall against real balances", () => {
    const req = bankrollRequirement(legs, "CONCURRENT");
    const short = bankrollShortfall(req, d("20"), d("0"));
    expect(short.sufficient).toBe(false);
    expectMoney(short.exchangeShortfall, "26.44");
    expectMoney(short.bookmakerShortfall, "0.00");
  });

  it("reports no shortfall when the balances cover it", () => {
    const req = bankrollRequirement(legs, "CONCURRENT");
    const fine = bankrollShortfall(req, d("100"), d("100"));
    expect(fine.sufficient).toBe(true);
    expectMoney(fine.exchangeShortfall, "0.00");
  });
});
