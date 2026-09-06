/**
 * The AI boundary.
 *
 * A language model in this product interprets TEXT and writes PROSE. It never
 * produces a stake, a liability, a return or a profit figure — those come from
 * lib/math, from deterministic inputs, and nowhere else. NumericGuard enforces
 * that at runtime rather than trusting a prompt to hold.
 */

export type ReadableFreeBetType = "SNR" | "SR" | "UNKNOWN";

export type PromotionKindGuess =
  | "SIGN_UP"
  | "RELOAD"
  | "REFUND_AS_TOKEN"
  | "ODDS_BOOST"
  | "ACCA_INSURANCE"
  | "OTHER";

/**
 * One field of a reading.
 *
 * `value: null` with `confidence: 0` is the correct and common answer when the
 * terms are silent. It is never filled in by inference — an unread field routes
 * the promotion to a person, which is cheap; a guessed one costs a customer
 * money.
 */
export interface FieldReading<T> {
  value: T | null;
  /** 0 to 1. Zero means "the terms did not say". */
  confidence: number;
  /** The exact phrase this was read from, quoted from the source. */
  sourcePhrase: string | null;
  note?: string;
}

export interface PromotionReading {
  kind: FieldReading<PromotionKindGuess>;
  qualifyingStake: FieldReading<string>;
  minQualifyingOdds: FieldReading<string>;
  maxQualifyingOdds: FieldReading<string>;
  rewardTotalValue: FieldReading<string>;
  rewardTokenCount: FieldReading<number>;
  rewardTokenValue: FieldReading<string>;
  /** The single most valuable field in a set of terms. */
  freeBetType: FieldReading<ReadableFreeBetType>;
  freeBetExpiryDays: FieldReading<number>;
  minRewardOdds: FieldReading<string>;
  maxRewardOdds: FieldReading<string>;
  eligibleSports: FieldReading<string[]>;
  wageringRequirement: FieldReading<string>;
}

export type ReadingField = keyof PromotionReading;

export interface InterpretRequest {
  title: string;
  rawText: string;
  operatorName: string;
  sourceUrl?: string;
}

export interface InterpretResult {
  reading: PromotionReading;
  /** Weighted across fields; the free-bet type dominates. */
  confidence: number;
  /** Fields the terms were silent on. */
  unreadableFields: ReadingField[];
  reasoning: string;
  providerName: string;
  providerModel: string | null;
  latencyMs: number;
  numericGuardFired: boolean;
  numericGuardDetail: string | null;
}

/**
 * A request for prose about an already-calculated opportunity.
 *
 * `deterministicFigures` is everything the model is permitted to quote. It is
 * built from engine output, so a figure that is not in it did not come from a
 * calculation and must not reach a customer.
 */
export interface ExplainRequest {
  /** Deterministic, engine-produced figures, as display strings. */
  deterministicFigures: string[];
  /** Deterministic text the model may quote from, e.g. an offer title. */
  sourceTexts: string[];
  /** Structured facts for the model to write about. */
  facts: Record<string, string>;
  question: string;
}

export interface ExplainResult {
  text: string;
  providerName: string;
  providerModel: string | null;
  numericGuardFired: boolean;
  numericGuardDetail: string | null;
  /** True when the guard could not be satisfied and engine output was used. */
  fellBackToDeterministicText: boolean;
}

export interface AiHealth {
  provider: string;
  model: string | null;
  ok: boolean;
  message: string;
  /** False for the stub: no model was contacted. */
  live: boolean;
  checkedAt: Date;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string | null;
  interpretPromotion(request: InterpretRequest): Promise<InterpretResult>;
  explain(request: ExplainRequest): Promise<ExplainResult>;
  healthCheck(): Promise<AiHealth>;
}

/**
 * How much each field contributes to the overall confidence.
 *
 * freeBetType carries the most weight by a wide margin: reading SNR as SR (or
 * the reverse) misstates a token's value by roughly a quarter of its face
 * value, which dwarfs the cost of any other misreading here.
 */
export const FIELD_WEIGHTS: Record<ReadingField, number> = {
  freeBetType: 0.3,
  qualifyingStake: 0.15,
  rewardTotalValue: 0.15,
  minQualifyingOdds: 0.12,
  rewardTokenValue: 0.1,
  rewardTokenCount: 0.06,
  minRewardOdds: 0.04,
  freeBetExpiryDays: 0.04,
  kind: 0.02,
  maxQualifyingOdds: 0.01,
  maxRewardOdds: 0.005,
  eligibleSports: 0.005,
  wageringRequirement: 0.0,
};

/** At or above this, a reading is complete enough to put in front of a
 *  reviewer as a quick approval. Below it, the reviewer starts from the raw
 *  text. Neither path publishes anything: only a person can do that. */
export const REVIEW_READY_CONFIDENCE = 0.75;

export function emptyField<T>(note?: string): FieldReading<T> {
  return { value: null, confidence: 0, sourcePhrase: null, ...(note ? { note } : {}) };
}

export function emptyReading(): PromotionReading {
  return {
    kind: emptyField<PromotionKindGuess>(),
    qualifyingStake: emptyField<string>(),
    minQualifyingOdds: emptyField<string>(),
    maxQualifyingOdds: emptyField<string>(),
    rewardTotalValue: emptyField<string>(),
    rewardTokenCount: emptyField<number>(),
    rewardTokenValue: emptyField<string>(),
    freeBetType: emptyField<ReadableFreeBetType>(),
    freeBetExpiryDays: emptyField<number>(),
    minRewardOdds: emptyField<string>(),
    maxRewardOdds: emptyField<string>(),
    eligibleSports: emptyField<string[]>(),
    wageringRequirement: emptyField<string>(),
  };
}

export function scoreReading(reading: PromotionReading): {
  confidence: number;
  unreadableFields: ReadingField[];
} {
  let total = 0;
  const unreadableFields: ReadingField[] = [];

  for (const field of Object.keys(FIELD_WEIGHTS) as ReadingField[]) {
    const entry = reading[field];
    total += FIELD_WEIGHTS[field] * entry.confidence;
    if (entry.value === null || entry.confidence === 0) unreadableFields.push(field);
  }

  return { confidence: Math.round(total * 10_000) / 10_000, unreadableFields };
}
