/**
 * NumericGuard.
 *
 * Every string a model produces that is bound for a customer passes through
 * here. Any money or percentage figure in it that was not in the deterministic
 * payload given to that call is rejected.
 *
 * The rule is not "the model should not do arithmetic". It is that a figure a
 * customer acts on must be traceable to lib/math or to the operator's own
 * words. A model that quotes "£30" from an offer title it was handed has
 * invented nothing; a model that says "you'll clear £24.17" when no such
 * figure was supplied has invented everything.
 */

export interface GuardContext {
  /**
   * Figures produced deterministically — engine output, database values.
   * Written as they would be displayed: "£22.50", "95.00%", "3.25".
   */
  deterministicFigures: string[];
  /**
   * Deterministic TEXT the model was given and may quote from: an offer
   * title like "Bet £10 — Get £30", the operator's raw terms. Figures found
   * inside these are allowed, because repeating them is quotation.
   */
  sourceTexts: string[];
}

export type GuardVerdict =
  | { ok: true }
  | { ok: false; offending: string[]; message: string };

/**
 * What counts as a figure a customer might act on:
 *
 *   - anything with a currency symbol            £10, £1,250.00
 *   - anything with two decimal places           22.50, 3.25
 *   - any percentage                             5%, 95.00%
 *
 * A bare integer ("3 free bets", "7 days") is not money-shaped and is left
 * alone — counting is not the failure mode this guards against.
 */
// A comma is only a thousands separator when three digits follow it, so that
// "£10, liability ..." yields "£10" and not "£10,".
const MONEY_PATTERN =
  /(?:[£$€]\s?\d+(?:,\d{3})*(?:\.\d+)?)|(?:\b\d+(?:,\d{3})*\.\d{2}\b)/g;
const PERCENT_PATTERN = /\b\d+(?:\.\d+)?\s*%/g;

export interface ExtractedFigure {
  raw: string;
  normalised: string;
  kind: "MONEY" | "PERCENT";
}

/** Canonical form so "£10", "10.00" and "£10.00" compare equal. */
function normaliseMoney(raw: string): string {
  const digits = raw.replace(/[£$€,\s]/g, "");
  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return `money:${digits}`;
  // Compared, never calculated with: a float is fine for equality of a value
  // that was already a display string on both sides.
  return `money:${value.toFixed(2)}`;
}

function normalisePercent(raw: string): string {
  const digits = raw.replace(/[%\s]/g, "");
  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return `percent:${digits}`;
  return `percent:${value.toFixed(2)}`;
}

export function extractFigures(text: string): ExtractedFigure[] {
  const found: ExtractedFigure[] = [];
  const seen = new Set<string>();

  // Percentages first, so "95.00%" is not also read as the money-shaped
  // "95.00" sitting inside it.
  const percentSpans: Array<[number, number]> = [];
  for (const match of text.matchAll(PERCENT_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    percentSpans.push([start, start + raw.length]);
    const normalised = normalisePercent(raw);
    if (!seen.has(normalised)) {
      seen.add(normalised);
      found.push({ raw: raw.trim(), normalised, kind: "PERCENT" });
    }
  }

  for (const match of text.matchAll(MONEY_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const insidePercent = percentSpans.some(([s, e]) => start >= s && end <= e);
    if (insidePercent) continue;

    const normalised = normaliseMoney(match[0]);
    if (!seen.has(normalised)) {
      seen.add(normalised);
      found.push({ raw: match[0].trim(), normalised, kind: "MONEY" });
    }
  }

  return found;
}

/**
 * Everything the model is permitted to state.
 *
 * Figures inside the supplied source texts are included: quoting the operator
 * back is not invention.
 */
export function buildAllowedSet(context: GuardContext): Set<string> {
  const allowed = new Set<string>();
  for (const figure of context.deterministicFigures) {
    for (const extracted of extractFigures(figure)) allowed.add(extracted.normalised);
    // A bare "22.50" passed as a deterministic figure should be allowed even
    // if it arrived without a currency symbol.
    const bare = Number.parseFloat(figure.replace(/[£$€,%\s]/g, ""));
    if (Number.isFinite(bare)) {
      allowed.add(`money:${bare.toFixed(2)}`);
      if (figure.includes("%")) allowed.add(`percent:${bare.toFixed(2)}`);
    }
  }
  for (const text of context.sourceTexts) {
    for (const extracted of extractFigures(text)) allowed.add(extracted.normalised);
  }
  return allowed;
}

export function checkNumericGuard(output: string, context: GuardContext): GuardVerdict {
  const allowed = buildAllowedSet(context);
  const offending = extractFigures(output)
    .filter((figure) => !allowed.has(figure.normalised))
    .map((figure) => figure.raw);

  if (offending.length === 0) return { ok: true };

  return {
    ok: false,
    offending,
    message:
      offending.length === 1
        ? `The figure ${offending[0]} was not among the calculated values supplied.`
        : `The figures ${offending.join(", ")} were not among the calculated values supplied.`,
  };
}

/** The correction sent back to the model on its one retry. */
export function buildCorrectionPrompt(verdict: Extract<GuardVerdict, { ok: false }>): string {
  return [
    `Your previous answer contained ${verdict.offending.length === 1 ? "a figure" : "figures"} that did not come from the calculated values provided: ${verdict.offending.join(", ")}.`,
    "Do not compute or estimate any monetary or percentage figure.",
    "Use only the figures supplied to you, exactly as they were written, or write the sentence without a figure at all.",
    "Rewrite your answer.",
  ].join(" ");
}

export interface GuardedGenerationOptions {
  /** Called once, then at most once more with a correction. */
  generate: (correction?: string) => Promise<string>;
  context: GuardContext;
  /** Deterministic text used if the model cannot be brought into line. */
  fallback: string;
}

export interface GuardedGenerationResult {
  text: string;
  guardFired: boolean;
  detail: string | null;
  fellBack: boolean;
}

/**
 * Generate, check, correct once, then fall back.
 *
 * Falling back to engine output is not a failure to be hidden: it is recorded
 * on the interpretation so a reviewer can see the guard did its job.
 */
export async function generateGuarded(
  options: GuardedGenerationOptions,
): Promise<GuardedGenerationResult> {
  const first = await options.generate();
  const firstVerdict = checkNumericGuard(first, options.context);
  if (firstVerdict.ok) {
    return { text: first, guardFired: false, detail: null, fellBack: false };
  }

  const second = await options.generate(buildCorrectionPrompt(firstVerdict));
  const secondVerdict = checkNumericGuard(second, options.context);
  if (secondVerdict.ok) {
    return {
      text: second,
      guardFired: true,
      detail: `Corrected after inventing: ${firstVerdict.offending.join(", ")}.`,
      fellBack: false,
    };
  }

  return {
    text: options.fallback,
    guardFired: true,
    detail: `Fell back to calculated text. Invented on both attempts: ${[
      ...new Set([...firstVerdict.offending, ...secondVerdict.offending]),
    ].join(", ")}.`,
    fellBack: true,
  };
}
