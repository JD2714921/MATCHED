import { childLogger } from "@/lib/logger";
import {
  emptyReading,
  scoreReading,
  type AiHealth,
  type AiProvider,
  type ExplainRequest,
  type ExplainResult,
  type FieldReading,
  type InterpretRequest,
  type InterpretResult,
  type PromotionReading,
  type ReadingField,
} from "../types";
import { generateGuarded } from "../guard";
import {
  EXPLANATION_SYSTEM_PROMPT,
  INTERPRETATION_SYSTEM_PROMPT,
  buildExplanationPrompt,
  buildInterpretationPrompt,
} from "../prompts";
import { composeDeterministicExplanation } from "../stub/provider";
import { parsePromotionTerms } from "../stub/parser";

const log = childLogger("ai-anthropic");

export const ANTHROPIC_PROVIDER_NAME = "anthropic";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

/**
 * The Anthropic adapter.
 *
 * UNVERIFIED: no API key was available in the environment this was written in,
 * so this has never made a real call. It is written to the documented Messages
 * API and its parsing is tested against recorded response shapes, which is not
 * the same as working. The stub provider is the default everywhere.
 *
 * Note what this class does NOT do: it never produces a figure that reaches a
 * customer unchecked. `explain` runs every output through NumericGuard, and
 * `interpretPromotion` takes only text and confidence from the model — every
 * monetary consequence of that reading is computed afterwards by lib/math.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly name = ANTHROPIC_PROVIDER_NAME;
  readonly model: string;

  readonly #apiKey: string;
  readonly #maxTokens: number;
  readonly #timeoutMs: number;

  constructor(config: AnthropicConfig) {
    if (!config.apiKey) {
      throw new Error("AnthropicAiProvider requires an API key.");
    }
    this.#apiKey = config.apiKey;
    this.model = config.model;
    this.#maxTokens = config.maxTokens ?? 2048;
    this.#timeoutMs = config.timeoutMs ?? 30_000;
  }

  async interpretPromotion(request: InterpretRequest): Promise<InterpretResult> {
    const startedAt = Date.now();

    let raw: string;
    try {
      raw = await this.#message(
        INTERPRETATION_SYSTEM_PROMPT,
        buildInterpretationPrompt(request),
      );
    } catch (cause) {
      // A model that cannot be reached must not stall the pipeline, and must
      // not silently produce an empty reading either: fall back to the
      // deterministic parser and say so.
      log.warn({ err: String(cause) }, "anthropic interpretation failed; using rule-based parser");
      const parsed = parsePromotionTerms(request.title, request.rawText);
      return {
        reading: parsed.reading,
        confidence: parsed.confidence,
        unreadableFields: parsed.unreadableFields,
        reasoning: `The language model could not be reached, so this was read by the deterministic rule-based parser instead. ${parsed.reasoning}`,
        providerName: `${this.name} (fell back to rule-based)`,
        providerModel: this.model,
        latencyMs: Date.now() - startedAt,
        numericGuardFired: false,
        numericGuardDetail: null,
      };
    }

    const { reading, reasoning } = parseReadingJson(raw);
    const { confidence, unreadableFields } = scoreReading(reading);

    return {
      reading,
      confidence,
      unreadableFields,
      reasoning,
      providerName: this.name,
      providerModel: this.model,
      latencyMs: Date.now() - startedAt,
      numericGuardFired: false,
      numericGuardDetail: null,
    };
  }

  async explain(request: ExplainRequest): Promise<ExplainResult> {
    const fallback = composeDeterministicExplanation(request);

    const result = await generateGuarded({
      context: {
        deterministicFigures: request.deterministicFigures,
        sourceTexts: request.sourceTexts,
      },
      fallback,
      generate: async (correction) => {
        const prompt = correction
          ? `${buildExplanationPrompt(request)}\n\n${correction}`
          : buildExplanationPrompt(request);
        try {
          return await this.#message(EXPLANATION_SYSTEM_PROMPT, prompt);
        } catch (cause) {
          log.warn({ err: String(cause) }, "anthropic explanation failed");
          return fallback;
        }
      },
    });

    return {
      text: result.text,
      providerName: this.name,
      providerModel: this.model,
      numericGuardFired: result.guardFired,
      numericGuardDetail: result.detail,
      fellBackToDeterministicText: result.fellBack,
    };
  }

  async healthCheck(): Promise<AiHealth> {
    try {
      await this.#message("Reply with the single word: ok", "ok");
      return {
        provider: this.name,
        model: this.model,
        ok: true,
        message: "Connected.",
        live: true,
        checkedAt: new Date(),
      };
    } catch (cause) {
      return {
        provider: this.name,
        model: this.model,
        ok: false,
        message: cause instanceof Error ? cause.message : String(cause),
        live: false,
        checkedAt: new Date(),
      };
    }
  }

  async #message(system: string, prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.#apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.#maxTokens,
          system,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });

      const body = (await response.json()) as AnthropicResponse;

      if (!response.ok || body.error) {
        throw new Error(
          `Anthropic returned ${response.status}: ${body.error?.message ?? "unknown error"}`,
        );
      }

      const text = (body.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("")
        .trim();

      if (!text) throw new Error("Anthropic returned an empty response.");
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Turn the model's JSON into a reading.
 *
 * Anything missing, malformed or out of range becomes an unread field rather
 * than a value — a garbled response must degrade to "a person should look at
 * this", never to a confident wrong answer.
 */
export function parseReadingJson(raw: string): { reading: PromotionReading; reasoning: string } {
  const reading = emptyReading();

  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return {
      reading,
      reasoning: "The model's response did not contain JSON, so nothing was read from it.",
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return {
      reading,
      reasoning: "The model's response was not valid JSON, so nothing was read from it.",
    };
  }

  for (const field of Object.keys(reading) as ReadingField[]) {
    const entry = parsed[field];
    if (!entry || typeof entry !== "object") continue;

    const candidate = entry as { value?: unknown; confidence?: unknown; sourcePhrase?: unknown };
    if (candidate.value === null || candidate.value === undefined) continue;

    const confidence =
      typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
        ? Math.min(1, Math.max(0, candidate.confidence))
        : 0;
    if (confidence === 0) continue;

    // A model asserting a value without quoting the phrase it came from has
    // not shown its working, so it is not trusted.
    const sourcePhrase =
      typeof candidate.sourcePhrase === "string" && candidate.sourcePhrase.trim() !== ""
        ? candidate.sourcePhrase
        : null;
    if (!sourcePhrase) continue;

    (reading[field] as FieldReading<unknown>) = {
      value: candidate.value,
      confidence,
      sourcePhrase,
    };
  }

  const reasoning =
    typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning was returned.";

  return { reading, reasoning };
}

/** Models sometimes wrap JSON in prose or a fence; take the outermost object. */
function extractJsonObject(raw: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}
