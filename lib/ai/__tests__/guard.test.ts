import { describe, it, expect, vi } from "vitest";
import {
  buildAllowedSet,
  buildCorrectionPrompt,
  checkNumericGuard,
  extractFigures,
  generateGuarded,
  type GuardContext,
} from "../guard";

const ENGINE_FIGURES = ["£10.00", "£22.50", "-£0.50", "95.00%", "3.25"];

function context(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    deterministicFigures: ENGINE_FIGURES,
    sourceTexts: [],
    ...overrides,
  };
}

describe("figure extraction", () => {
  it("finds currency amounts however they are written", () => {
    const figures = extractFigures("Stake £10, liability £22.50, and £1,250.00 in total.");
    expect(figures.map((f) => f.raw)).toEqual(["£10", "£22.50", "£1,250.00"]);
  });

  it("treats any two-decimal number as money-shaped", () => {
    expect(extractFigures("the lay stake is 22.50").map((f) => f.normalised)).toEqual([
      "money:22.50",
    ]);
  });

  it("finds percentages", () => {
    expect(extractFigures("a rating of 95.00% and 5% commission").map((f) => f.raw)).toEqual([
      "95.00%",
      "5%",
    ]);
  });

  it("does not read the number inside a percentage as money as well", () => {
    const figures = extractFigures("95.00%");
    expect(figures).toHaveLength(1);
    expect(figures[0]!.kind).toBe("PERCENT");
  });

  it("leaves bare integers alone — counting is not the failure mode", () => {
    expect(extractFigures("3 free bets valid for 7 days")).toEqual([]);
  });

  it("normalises so £10, 10.00 and £10.00 compare equal", () => {
    const a = extractFigures("£10")[0]!.normalised;
    const b = extractFigures("10.00")[0]!.normalised;
    const c = extractFigures("£10.00")[0]!.normalised;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe("the guard", () => {
  it("passes text that quotes only supplied figures", () => {
    const verdict = checkNumericGuard(
      "Lay £10.00 at 3.25. Your liability is £22.50 and the qualifying loss is £0.50 either way.",
      context(),
    );
    expect(verdict.ok).toBe(true);
  });

  it("rejects a figure that was never supplied", () => {
    const verdict = checkNumericGuard("You will clear £24.17 on this one.", context());
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.offending).toEqual(["£24.17"]);
    expect(verdict.message).toContain("£24.17");
  });

  it("rejects an invented percentage", () => {
    const verdict = checkNumericGuard("That is a rating of 98.20%.", context());
    expect(verdict.ok).toBe(false);
  });

  it("catches arithmetic the model did itself", () => {
    // £10.00 and £22.50 are both allowed; their difference is not.
    const verdict = checkNumericGuard(
      "Your £10.00 stake against £22.50 of liability leaves £12.50 at risk.",
      context(),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.offending).toEqual(["£12.50"]);
  });

  it("reports every invented figure, not just the first", () => {
    const verdict = checkNumericGuard("Expect £24.17, or £31.09 at better prices.", context());
    if (verdict.ok) throw new Error("expected a rejection");
    expect(verdict.offending).toEqual(["£24.17", "£31.09"]);
  });

  it("allows a figure quoted from deterministic text it was given", () => {
    // The model was handed the offer title. Repeating "£30" out of it is
    // quotation, not invention — this is the case the guard must not break.
    const verdict = checkNumericGuard(
      "This is the Bet £10 — Get £30 offer, so lay £10.00 at 3.25.",
      context({ sourceTexts: ["Bet £10 — Get £30 in free bets"] }),
    );
    expect(verdict.ok).toBe(true);
  });

  it("still rejects a figure absent from both the figures and the source text", () => {
    const verdict = checkNumericGuard(
      "The Bet £10 — Get £30 offer is worth about £22.80 to you.",
      context({ sourceTexts: ["Bet £10 — Get £30 in free bets"] }),
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.offending).toEqual(["£22.80"]);
  });

  it("accepts prose with no figures at all", () => {
    expect(checkNumericGuard("Place the back bet first, then the lay.", context()).ok).toBe(true);
  });

  it("accepts a bare deterministic figure supplied without a currency symbol", () => {
    const allowed = buildAllowedSet({ deterministicFigures: ["22.5"], sourceTexts: [] });
    expect(allowed.has("money:22.50")).toBe(true);
  });
});

describe("correction and fallback", () => {
  it("accepts a clean first answer without a retry", async () => {
    const generate = vi.fn(async () => "Lay £10.00 at 3.25.");
    const result = await generateGuarded({
      generate,
      context: context(),
      fallback: "fallback text",
    });
    expect(result.guardFired).toBe(false);
    expect(result.fellBack).toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("corrects once, naming the offending figure", async () => {
    const generate = vi
      .fn<(correction?: string) => Promise<string>>()
      .mockResolvedValueOnce("You will clear £24.17.")
      .mockResolvedValueOnce("Lay £10.00 at 3.25 to lock the position.");

    const result = await generateGuarded({
      generate,
      context: context(),
      fallback: "fallback text",
    });

    expect(generate).toHaveBeenCalledTimes(2);
    const correction = generate.mock.calls[1]![0]!;
    expect(correction).toContain("£24.17");
    expect(correction).toContain("Do not compute or estimate");
    expect(result.guardFired).toBe(true);
    expect(result.fellBack).toBe(false);
    expect(result.text).toContain("£10.00");
    expect(result.detail).toContain("£24.17");
  });

  it("falls back to deterministic text after one failed correction", async () => {
    const generate = vi
      .fn<(correction?: string) => Promise<string>>()
      .mockResolvedValueOnce("You will clear £24.17.")
      .mockResolvedValueOnce("Sorry — you will clear £24.20.");

    const result = await generateGuarded({
      generate,
      context: context(),
      fallback: "Calculated return: £0.50 against you either way.",
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.fellBack).toBe(true);
    expect(result.guardFired).toBe(true);
    expect(result.text).toBe("Calculated return: £0.50 against you either way.");
    expect(result.detail).toContain("£24.17");
    expect(result.detail).toContain("£24.20");
  });

  it("never tries a third time", async () => {
    const generate = vi.fn(async () => "always £99.99");
    await generateGuarded({ generate, context: context(), fallback: "fallback" });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("writes a correction a model can act on", () => {
    const prompt = buildCorrectionPrompt({
      ok: false,
      offending: ["£24.17"],
      message: "x",
    });
    expect(prompt).toContain("£24.17");
    expect(prompt).toContain("Rewrite your answer");
  });
});
