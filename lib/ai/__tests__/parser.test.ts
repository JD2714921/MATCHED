import { describe, it, expect } from "vitest";
import { parsePromotionTerms, parseOddsToken } from "../stub/parser";
import { StubAiProvider } from "../stub/provider";
import { parseReadingJson } from "../anthropic/provider";
import { REVIEW_READY_CONFIDENCE, scoreReading, FIELD_WEIGHTS } from "../types";

const CLEAR_TERMS = `
Place a qualifying bet of £10 at minimum odds of 1.50 on any Football or Tennis market.
Once your qualifying bet settles we will credit 3 x £10 free bets.
The free bet stake is not returned with any winnings.
Free bets expire 7 days after being credited. Minimum odds of 1.20 apply to the free bet.
New customers only.
`;

const AMBIGUOUS_TERMS = `
Bet £20 on selected markets this weekend and we will reward you.
Rewards are credited at our discretion once the promotion closes.
Terms apply.
`;

describe("reading clear terms", () => {
  const parsed = parsePromotionTerms("Bet £10 — Get £30 in Free Bets", CLEAR_TERMS);

  it("reads the free-bet type from an explicit statement", () => {
    expect(parsed.reading.freeBetType.value).toBe("SNR");
    expect(parsed.reading.freeBetType.confidence).toBeGreaterThan(0.9);
    expect(parsed.reading.freeBetType.sourcePhrase).toContain("not returned");
  });

  it("reads the qualifying stake and the reward", () => {
    expect(parsed.reading.qualifyingStake.value).toBe("10.00");
    expect(parsed.reading.rewardTotalValue.value).toBe("30.00");
  });

  it("reads the token split", () => {
    expect(parsed.reading.rewardTokenCount.value).toBe(3);
    expect(parsed.reading.rewardTokenValue.value).toBe("10.00");
  });

  it("tells the qualifying minimum odds from the free-bet minimum odds", () => {
    expect(parsed.reading.minQualifyingOdds.value).toBe("1.5000");
    expect(parsed.reading.minRewardOdds.value).toBe("1.2000");
  });

  it("reads the expiry and the eligible sports", () => {
    expect(parsed.reading.freeBetExpiryDays.value).toBe(7);
    expect(parsed.reading.eligibleSports.value).toEqual(["Football", "Tennis"]);
  });

  it("identifies the kind of promotion", () => {
    expect(parsed.reading.kind.value).toBe("SIGN_UP");
  });

  it("is confident enough to put in front of a reviewer as a quick approval", () => {
    expect(parsed.confidence).toBeGreaterThanOrEqual(REVIEW_READY_CONFIDENCE);
  });

  it("quotes the phrase every value was read from", () => {
    for (const field of Object.keys(parsed.reading) as Array<keyof typeof parsed.reading>) {
      const entry = parsed.reading[field];
      if (entry.value !== null) {
        expect(entry.sourcePhrase, `${field} has a value but no source phrase`).toBeTruthy();
      }
    }
  });
});

describe("refusing to guess", () => {
  const parsed = parsePromotionTerms("Weekend Reward", AMBIGUOUS_TERMS);

  it("leaves the free-bet type unread when the terms do not say", () => {
    expect(parsed.reading.freeBetType.value).toBeNull();
    expect(parsed.reading.freeBetType.confidence).toBe(0);
    expect(parsed.reading.freeBetType.note).toContain("do not say");
  });

  it("explains why the missing field matters", () => {
    expect(parsed.reading.freeBetType.note).toContain("quarter");
  });

  it("reads what IS stated and nothing more", () => {
    expect(parsed.reading.qualifyingStake.value).toBe("20.00");
    expect(parsed.reading.rewardTotalValue.value).toBeNull();
    expect(parsed.reading.minQualifyingOdds.value).toBeNull();
    expect(parsed.reading.freeBetExpiryDays.value).toBeNull();
  });

  it("falls below the review-ready threshold, routing it to a person", () => {
    expect(parsed.confidence).toBeLessThan(REVIEW_READY_CONFIDENCE);
  });

  it("lists every field the terms were silent on", () => {
    expect(parsed.unreadableFields).toContain("freeBetType");
    expect(parsed.unreadableFields).toContain("rewardTotalValue");
    expect(parsed.reasoning).toContain("NOT established");
  });

  it("refuses contradictory terms rather than picking one", () => {
    const contradictory = parsePromotionTerms(
      "Confusing offer",
      "The free bet stake is not returned. Elsewhere: the free bet stake is returned with any winnings.",
    );
    expect(contradictory.reading.freeBetType.value).toBeNull();
    expect(contradictory.reading.freeBetType.note).toContain("Contradictory");
  });

  it("reads a stake-returned offer as SR when the terms say so", () => {
    const sr = parsePromotionTerms(
      "SR offer",
      "Your free bet stake is returned with any winnings.",
    );
    expect(sr.reading.freeBetType.value).toBe("SR");
  });

  it("does not read 'stake not returned' as SR because it contains 'returned'", () => {
    const snr = parsePromotionTerms("x", "Free bet stake not returned.");
    expect(snr.reading.freeBetType.value).toBe("SNR");
  });
});

describe("weighting", () => {
  it("weights the free-bet type above every other field", () => {
    const others = Object.entries(FIELD_WEIGHTS).filter(([f]) => f !== "freeBetType");
    for (const [, weight] of others) {
      expect(FIELD_WEIGHTS.freeBetType).toBeGreaterThan(weight);
    }
  });

  it("uses weights that sum to one", () => {
    const total = Object.values(FIELD_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("costs a reading most of its confidence when the free-bet type is unread", () => {
    const withType = parsePromotionTerms("x", CLEAR_TERMS);
    const withoutType = parsePromotionTerms(
      "x",
      CLEAR_TERMS.replace("The free bet stake is not returned with any winnings.", ""),
    );
    expect(withType.confidence - withoutType.confidence).toBeGreaterThan(0.25);
  });

  it("scores an empty reading at zero", () => {
    const { confidence, unreadableFields } = scoreReading(
      parsePromotionTerms("", "").reading,
    );
    expect(confidence).toBe(0);
    expect(unreadableFields.length).toBeGreaterThan(10);
  });
});

describe("odds written the way UK terms write them", () => {
  it("reads decimal odds", () => {
    expect(parseOddsToken("1.50")).toBe("1.5000");
    expect(parseOddsToken("2")).toBe("2.0000");
  });

  it("reads fractional odds", () => {
    expect(parseOddsToken("1/2")).toBe("1.5000");
    expect(parseOddsToken("5/1")).toBe("6.0000");
    expect(parseOddsToken("11/4")).toBe("3.7500");
  });

  it("reads evens", () => {
    expect(parseOddsToken("evens")).toBe("2.0000");
    expect(parseOddsToken("EVS")).toBe("2.0000");
  });

  it("refuses anything that is not odds", () => {
    expect(parseOddsToken("0.5")).toBeNull();
    expect(parseOddsToken("soon")).toBeNull();
    expect(parseOddsToken("5000")).toBeNull();
    expect(parseOddsToken("1/0")).toBeNull();
  });

  it("prefers the parenthesised decimal when terms give both", () => {
    const parsed = parsePromotionTerms("x", "Minimum odds of evens (2.0) apply.");
    expect(parsed.reading.minQualifyingOdds.value).toBe("2.0000");
  });

  it("reads fractional minimum odds from the terms", () => {
    const parsed = parsePromotionTerms("x", "Qualifying bet at min odds 1/2 or greater.");
    expect(parsed.reading.minQualifyingOdds.value).toBe("1.5000");
  });
});

describe("the stub provider", () => {
  const provider = new StubAiProvider();

  it("never claims a model was contacted", async () => {
    const health = await provider.healthCheck();
    expect(health.live).toBe(false);
    expect(health.message).toContain("No language model has been contacted");
  });

  it("returns a reading with provenance", async () => {
    const result = await provider.interpretPromotion({
      title: "Bet £10 — Get £30 in Free Bets",
      rawText: CLEAR_TERMS,
      operatorName: "Northgate Bet",
    });
    expect(result.providerName).toBe("stub");
    expect(result.providerModel).toBeNull();
    expect(result.numericGuardFired).toBe(false);
    expect(result.reading.freeBetType.value).toBe("SNR");
  });

  it("only ever states figures it was handed", async () => {
    const result = await provider.explain({
      deterministicFigures: ["£10.00", "£22.50", "-£0.50"],
      sourceTexts: [],
      facts: { "Lay stake": "£10.00", Liability: "£22.50", "Either outcome": "-£0.50" },
      question: "Explain this qualifying bet.",
    });
    expect(result.numericGuardFired).toBe(false);
    expect(result.text).toContain("£22.50");
  });
});

describe("parsing a model's JSON", () => {
  it("reads a well-formed response", () => {
    const { reading, reasoning } = parseReadingJson(
      JSON.stringify({
        freeBetType: { value: "SNR", confidence: 0.9, sourcePhrase: "stake not returned" },
        qualifyingStake: { value: "10.00", confidence: 0.95, sourcePhrase: "bet £10" },
        reasoning: "Read both fields.",
      }),
    );
    expect(reading.freeBetType.value).toBe("SNR");
    expect(reading.qualifyingStake.value).toBe("10.00");
    expect(reasoning).toBe("Read both fields.");
  });

  it("finds JSON inside a fenced block or surrounding prose", () => {
    const { reading } = parseReadingJson(
      'Here you go:\n```json\n{"freeBetType":{"value":"SR","confidence":0.8,"sourcePhrase":"stake returned"}}\n```\nHope that helps.',
    );
    expect(reading.freeBetType.value).toBe("SR");
  });

  it("degrades to an unread field rather than a wrong one when the JSON is broken", () => {
    for (const bad of ["not json at all", "{ broken", "```json\n{oops}\n```"]) {
      const { reading } = parseReadingJson(bad);
      expect(reading.freeBetType.value).toBeNull();
      expect(reading.freeBetType.confidence).toBe(0);
    }
  });

  it("ignores a value the model asserted without quoting a source phrase", () => {
    // Showing the working is the price of being believed.
    const { reading } = parseReadingJson(
      JSON.stringify({ freeBetType: { value: "SNR", confidence: 0.99, sourcePhrase: "" } }),
    );
    expect(reading.freeBetType.value).toBeNull();
  });

  it("ignores a value the model gave zero confidence to", () => {
    const { reading } = parseReadingJson(
      JSON.stringify({ freeBetType: { value: "SR", confidence: 0, sourcePhrase: "somewhere" } }),
    );
    expect(reading.freeBetType.value).toBeNull();
  });

  it("clamps a confidence outside 0..1", () => {
    const { reading } = parseReadingJson(
      JSON.stringify({ freeBetType: { value: "SR", confidence: 42, sourcePhrase: "here" } }),
    );
    expect(reading.freeBetType.confidence).toBe(1);
  });
});
