import { env } from "@/lib/env";
import { childLogger } from "@/lib/logger";
import type { AiProvider } from "./types";
import { StubAiProvider } from "./stub/provider";
import { AnthropicAiProvider } from "./anthropic/provider";

const log = childLogger("ai");

export * from "./types";
export * from "./guard";
export { StubAiProvider, composeDeterministicExplanation } from "./stub/provider";
export { AnthropicAiProvider, parseReadingJson } from "./anthropic/provider";
export { parsePromotionTerms, parseOddsToken } from "./stub/parser";
export {
  INTERPRETATION_SYSTEM_PROMPT,
  EXPLANATION_SYSTEM_PROMPT,
  buildInterpretationPrompt,
  buildExplanationPrompt,
} from "./prompts";

let cached: AiProvider | null = null;

/**
 * Build the configured provider.
 *
 * The stub is the default in development and always used in tests. Selecting
 * `anthropic` without a key falls back to the stub with a warning rather than
 * failing at request time — but the fallback is loud, and the provider name
 * recorded against every interpretation says which one actually ran.
 */
export function getAiProvider(): AiProvider {
  if (cached) return cached;

  if (env.AI_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY) {
    cached = new AnthropicAiProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
    });
    return cached;
  }

  if (env.AI_PROVIDER === "anthropic") {
    log.warn("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is unset; using the rule-based stub");
  }

  cached = new StubAiProvider();
  return cached;
}

/** Test seam. */
export function resetAiProvider(): void {
  cached = null;
}
