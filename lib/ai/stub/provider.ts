import {
  type AiHealth,
  type AiProvider,
  type ExplainRequest,
  type ExplainResult,
  type InterpretRequest,
  type InterpretResult,
} from "../types";
import { checkNumericGuard } from "../guard";
import { parsePromotionTerms } from "./parser";

export const STUB_PROVIDER_NAME = "stub";

/**
 * The deterministic provider.
 *
 * Default in development and ALWAYS the provider in tests, so the whole
 * pipeline — collection, interpretation, the confidence gate, the human
 * verification queue — runs with no API key and no network.
 *
 * Its explanations are assembled from the deterministic figures it is handed,
 * so they pass NumericGuard by construction rather than by luck.
 */
export class StubAiProvider implements AiProvider {
  readonly name = STUB_PROVIDER_NAME;
  readonly model = null;

  async interpretPromotion(request: InterpretRequest): Promise<InterpretResult> {
    const startedAt = Date.now();
    const parsed = parsePromotionTerms(request.title, request.rawText);

    return {
      reading: parsed.reading,
      confidence: parsed.confidence,
      unreadableFields: parsed.unreadableFields,
      reasoning: parsed.reasoning,
      providerName: this.name,
      providerModel: null,
      latencyMs: Date.now() - startedAt,
      numericGuardFired: false,
      numericGuardDetail: null,
    };
  }

  async explain(request: ExplainRequest): Promise<ExplainResult> {
    const text = composeDeterministicExplanation(request);

    // Belt and braces: even text this module assembled itself is checked, so
    // a future edit that starts deriving a figure gets caught by the same
    // mechanism that guards a live model.
    const verdict = checkNumericGuard(text, {
      deterministicFigures: request.deterministicFigures,
      sourceTexts: request.sourceTexts,
    });

    return {
      text,
      providerName: this.name,
      providerModel: null,
      numericGuardFired: !verdict.ok,
      numericGuardDetail: verdict.ok ? null : verdict.message,
      fellBackToDeterministicText: true,
    };
  }

  async healthCheck(): Promise<AiHealth> {
    return {
      provider: this.name,
      model: null,
      ok: true,
      message:
        "Deterministic rule-based provider. No language model has been contacted; readings come from pattern matching and leave anything unstated blank.",
      live: false,
      checkedAt: new Date(),
    };
  }
}

/**
 * Assemble prose from the supplied facts and figures alone.
 *
 * Every figure in the output is one that was passed in, so nothing here can
 * introduce a number a customer might act on.
 */
export function composeDeterministicExplanation(request: ExplainRequest): string {
  const parts: string[] = [];
  for (const [label, value] of Object.entries(request.facts)) {
    parts.push(`${label}: ${value}`);
  }
  if (parts.length === 0) return "No calculated figures were supplied for this position.";
  return parts.join(". ") + ".";
}
