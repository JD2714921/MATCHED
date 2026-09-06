import type { ExplainRequest, InterpretRequest } from "./types";

/**
 * The system prompt is not the safety mechanism — NumericGuard is. But saying
 * plainly what the model is and is not for makes the guard fire far less
 * often, and makes a firing meaningful when it happens.
 */
export const INTERPRETATION_SYSTEM_PROMPT = [
  "You read UK bookmaker promotional terms and report what they say.",
  "",
  "Rules:",
  "1. Report only what the terms state. Where the terms are silent, return null with a confidence of 0. Never infer, never default, never fill a gap with what is usual.",
  "2. The most important field is whether a free bet's stake is returned (SR) or not returned (SNR). Read it from an explicit statement only. If the terms do not say, return null — the difference is about a quarter of the token's value and must not be assumed.",
  "3. For every field you do read, quote the exact phrase you read it from.",
  "4. Do not calculate anything. Do not work out what an offer is worth, what to stake, or what anyone would make. Those are computed elsewhere from your reading.",
  "5. Return strictly the JSON schema you are given, and nothing else.",
].join("\n");

export function buildInterpretationPrompt(request: InterpretRequest): string {
  return [
    `Operator: ${request.operatorName}`,
    `Offer title: ${request.title}`,
    request.sourceUrl ? `Source: ${request.sourceUrl}` : null,
    "",
    "Terms as published:",
    "---",
    request.rawText,
    "---",
    "",
    "Return JSON with this shape. Every field is an object of",
    '{ "value": <value or null>, "confidence": <0 to 1>, "sourcePhrase": <exact quote or null> }:',
    "",
    JSON.stringify(
      {
        kind: "SIGN_UP | RELOAD | REFUND_AS_TOKEN | ODDS_BOOST | ACCA_INSURANCE | OTHER",
        qualifyingStake: "decimal string, e.g. \"10.00\"",
        minQualifyingOdds: "decimal string, e.g. \"1.5000\"",
        maxQualifyingOdds: "decimal string or null",
        rewardTotalValue: "decimal string",
        rewardTokenCount: "integer",
        rewardTokenValue: "decimal string",
        freeBetType: "SNR | SR",
        freeBetExpiryDays: "integer",
        minRewardOdds: "decimal string or null",
        maxRewardOdds: "decimal string or null",
        eligibleSports: "array of sport names",
        wageringRequirement: "string or null",
      },
      null,
      2,
    ),
    "",
    "Also return a top-level \"reasoning\" string describing what you could and could not read.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export const EXPLANATION_SYSTEM_PROMPT = [
  "You write short, plain explanations of an already-calculated matched-betting position for a UK customer.",
  "",
  "Absolute rules:",
  "1. You must NOT calculate, estimate, derive or round any monetary or percentage figure.",
  "2. You may state a figure ONLY by copying one you were given, exactly as it was written.",
  "3. If a sentence would need a figure you were not given, write the sentence without it.",
  "4. Never describe any outcome as guaranteed, risk-free or without risk. Describe what the calculation shows across the possible outcomes.",
  "5. Be brief and concrete. Two or three sentences.",
].join("\n");

export function buildExplanationPrompt(request: ExplainRequest): string {
  return [
    request.question,
    "",
    "Facts:",
    ...Object.entries(request.facts).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "The ONLY figures you may state, copied exactly:",
    ...request.deterministicFigures.map((figure) => `- ${figure}`),
    ...(request.sourceTexts.length > 0
      ? ["", "You may also quote from this text as published:", ...request.sourceTexts.map((t) => `- ${t}`)]
      : []),
  ].join("\n");
}
