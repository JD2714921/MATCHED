import {
  emptyReading,
  scoreReading,
  type FieldReading,
  type PromotionKindGuess,
  type PromotionReading,
  type ReadableFreeBetType,
} from "../types";

/**
 * A deterministic, rule-based reading of promotion terms.
 *
 * THE GOVERNING RULE: where the terms are silent, this returns null with zero
 * confidence. It never infers, never defaults, never fills a gap with the
 * common case. An unread field routes the promotion to a person, which costs
 * a minute; a guessed field costs a customer money and is invisible until it
 * does.
 *
 * This is the default provider in development and ALWAYS the provider in
 * tests, so the whole pipeline is exercised with no API key and no network.
 */

interface Found {
  text: string;
  index: number;
}

function firstMatch(source: string, pattern: RegExp): RegExpMatchArray | null {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const match = re.exec(source);
  return match;
}

function allMatches(source: string, pattern: RegExp): RegExpMatchArray[] {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return [...source.matchAll(re)];
}

function read<T>(value: T, confidence: number, sourcePhrase: string, note?: string): FieldReading<T> {
  return { value, confidence, sourcePhrase, ...(note ? { note } : {}) };
}

/** Not stated. The honest answer, and a common one. */
function unread<T>(note: string): FieldReading<T> {
  return { value: null, confidence: 0, sourcePhrase: null, note };
}

function money(raw: string): string {
  const cleaned = raw.replace(/[£,\s]/g, "");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value.toFixed(2) : cleaned;
}

/**
 * Odds as written in UK terms: decimal, fractional, or "evens".
 */
export function parseOddsToken(token: string): string | null {
  const cleaned = token.trim().toLowerCase();
  if (cleaned === "evens" || cleaned === "evs" || cleaned === "even money") return "2.0000";

  const fractional = /^(\d+)\s*\/\s*(\d+)$/.exec(cleaned);
  if (fractional) {
    const numerator = Number(fractional[1]);
    const denominator = Number(fractional[2]);
    if (denominator === 0) return null;
    return (numerator / denominator + 1).toFixed(4);
  }

  const decimal = /^\d+(?:\.\d+)?$/.exec(cleaned);
  if (decimal) {
    const value = Number(cleaned);
    // A "minimum odds" of 0.5 is not odds; refuse rather than coerce.
    if (value < 1.01 || value > 1000) return null;
    return value.toFixed(4);
  }

  return null;
}

// ---------------------------------------------------------------------------

const SNR_PHRASES = [
  /free\s+bet\s+stake\s+(?:is\s+)?not\s+(?:returned|included)/i,
  /stake\s+(?:is\s+)?not\s+returned/i,
  /stake\s+not\s+included\s+in\s+(?:any\s+)?(?:winnings|returns)/i,
  /winnings\s+only/i,
  /excludes?\s+(?:the\s+)?(?:free\s+bet\s+)?stake/i,
  /\bSNR\b/,
];

const SR_PHRASES = [
  /free\s+bet\s+stake\s+(?:is\s+)?returned/i,
  /stake\s+(?:is\s+)?returned\s+with\s+(?:any\s+)?winnings/i,
  /stake\s+included\s+in\s+(?:any\s+)?(?:winnings|returns)/i,
  /returned\s+with\s+(?:your\s+)?winnings/i,
  /\bSR\b/,
];

/**
 * The free-bet type, read with the most care of any field.
 *
 * Negative phrasings are tested first: "stake not returned" contains "stake
 * ... returned", and reading it as SR overstates a token by about a quarter of
 * its face value.
 */
function readFreeBetType(text: string): FieldReading<ReadableFreeBetType> {
  const snr = SNR_PHRASES.map((p) => firstMatch(text, p)).find(Boolean);
  const sr = SR_PHRASES.map((p) => firstMatch(text, p)).find(Boolean);

  if (snr && sr) {
    return unread<ReadableFreeBetType>(
      `The terms say both "${snr[0]}" and "${sr[0]}". Contradictory, so this must be read by a person.`,
    );
  }
  if (snr) return read<ReadableFreeBetType>("SNR", 0.95, snr[0]);
  if (sr) return read<ReadableFreeBetType>("SR", 0.95, sr[0]);

  return unread<ReadableFreeBetType>(
    "The terms do not say whether the free-bet stake is returned. This changes a token's value by roughly a quarter, so it cannot be assumed.",
  );
}

function readKind(text: string): FieldReading<PromotionKindGuess> {
  const rules: Array<[RegExp, PromotionKindGuess]> = [
    [/acca\s+insurance|accumulator\s+insurance/i, "ACCA_INSURANCE"],
    [/price\s+boost|odds\s+boost|enhanced\s+odds/i, "ODDS_BOOST"],
    [/money\s+back|refund(?:ed)?\s+(?:as|in)\s+(?:a\s+)?free\s+bet/i, "REFUND_AS_TOKEN"],
    [/new\s+(?:customer|player|account)s?|sign[\s-]?up|first\s+bet|opening\s+account/i, "SIGN_UP"],
    [/existing\s+customers?|reload|weekly\s+offer/i, "RELOAD"],
  ];
  for (const [pattern, kind] of rules) {
    const match = firstMatch(text, pattern);
    if (match) return read(kind, 0.8, match[0]);
  }
  return unread<PromotionKindGuess>("The terms do not identify what kind of promotion this is.");
}

function readQualifyingStake(text: string): FieldReading<string> {
  const patterns = [
    /(?:qualifying\s+bet\s+of|place\s+a\s+bet\s+of|stake)\s*£\s?([\d,]+(?:\.\d{2})?)/i,
    /\bbet\s*£\s?([\d,]+(?:\.\d{2})?)/i,
    /\bwager\s*£\s?([\d,]+(?:\.\d{2})?)/i,
    /deposit\s+and\s+(?:bet|stake)\s*£\s?([\d,]+(?:\.\d{2})?)/i,
  ];
  for (const pattern of patterns) {
    const match = firstMatch(text, pattern);
    if (match?.[1]) return read(money(match[1]), 0.9, match[0]);
  }
  return unread<string>("The terms do not state a qualifying stake.");
}

function readRewardTotal(text: string): FieldReading<string> {
  // "up to" is checked first wherever it appears, because a maximum read as a
  // fixed amount overstates what the customer will actually receive.
  const patterns = [
    /up\s+to\s+£\s?([\d,]+(?:\.\d{2})?)/i,
    /(?:get|receive|claim|credit|award)\s+(?:you\s+)?(?:a|an|one)?\s*£\s?([\d,]+(?:\.\d{2})?)/i,
    /£\s?([\d,]+(?:\.\d{2})?)\s+(?:in\s+)?free\s+bets?/i,
    /£\s?([\d,]+(?:\.\d{2})?)\s+as\s+a\s+free\s+bet/i,
  ];
  for (const pattern of patterns) {
    const match = firstMatch(text, pattern);
    if (match?.[1]) {
      const uncertain = /up\s+to/i.test(match[0]);
      return read(
        money(match[1]),
        uncertain ? 0.5 : 0.9,
        match[0],
        uncertain
          ? "Stated as a maximum, so the actual reward may be lower than this."
          : undefined,
      );
    }
  }
  return unread<string>("The terms do not state a total reward value.");
}

function readTokens(text: string): {
  count: FieldReading<number>;
  value: FieldReading<string>;
} {
  const match = firstMatch(text, /(\d+)\s*(?:x|×)\s*£\s?([\d,]+(?:\.\d{2})?)/i);
  if (match?.[1] && match[2]) {
    return {
      count: read(Number(match[1]), 0.9, match[0]),
      value: read(money(match[2]), 0.9, match[0]),
    };
  }

  // "a £10 free bet" and "one £10 free bet" both state a single token, which
  // is a fact in the terms rather than an inference from silence.
  const worded = firstMatch(
    text,
    /\b(a|an|one|two|three|four|five|six)\s+£\s?([\d,]+(?:\.\d{2})?)\s+free\s+bets?/i,
  );
  if (worded?.[1] && worded[2]) {
    const words: Record<string, number> = {
      a: 1,
      an: 1,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
    };
    return {
      count: read(words[worded[1].toLowerCase()]!, 0.85, worded[0]),
      value: read(money(worded[2]), 0.85, worded[0]),
    };
  }

  return {
    count: unread<number>("The terms do not say how many separate tokens are awarded."),
    value: unread<string>("The terms do not state a per-token value."),
  };
}

const ODDS_TOKEN = String.raw`(evens|evs|even money|\d+\s*\/\s*\d+|\d+(?:\.\d+)?)`;

const DIGIT = /\d/;

/**
 * Is the character at `i` the end of a sentence?
 *
 * A full stop between two digits is a decimal point, not a full stop. Without
 * this, the sentence around "Minimum odds of 1.20 apply to the free bet" ends
 * at "1" and loses the words that say which bet it applies to.
 */
function isSentenceBoundary(text: string, i: number): boolean {
  const char = text[i];
  if (char === "\n" || char === ";") return true;
  if (char !== ".") return false;
  return !(DIGIT.test(text[i - 1] ?? "") && DIGIT.test(text[i + 1] ?? ""));
}

/** The sentence containing `index`, bounded by full stops and line breaks. */
export function sentenceAround(text: string, index: number): string {
  let start = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (isSentenceBoundary(text, i)) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = index; i < text.length; i += 1) {
    if (isSentenceBoundary(text, i)) {
      end = i;
      break;
    }
  }
  return text.slice(start, end);
}

function readOddsBounds(text: string): {
  minQualifying: FieldReading<string>;
  maxQualifying: FieldReading<string>;
  minReward: FieldReading<string>;
  maxReward: FieldReading<string>;
} {
  const minMatches = allMatches(
    text,
    new RegExp(
      String.raw`(?:min(?:imum)?\.?\s+odds\s+(?:of\s+)?|odds\s+of\s+)${ODDS_TOKEN}(?:\s*\(([^)]+)\))?`,
      "i",
    ),
  );
  const maxMatches = allMatches(
    text,
    new RegExp(String.raw`max(?:imum)?\.?\s+odds\s+(?:of\s+)?${ODDS_TOKEN}`, "i"),
  );

  // Which bound belongs to the free bet rather than the qualifying bet is
  // decided by what the SENTENCE containing it is talking about.
  //
  // Deliberately the sentence and not a character window: the offer title is
  // prepended to the terms, so a fixed lookback from "minimum odds of 1.50" in
  // "Bet £10 — Get £30 in Free Bets ... at minimum odds of 1.50" reaches back
  // into the title and reads a qualifying bound as a free-bet one.
  const forFreeBet = (match: RegExpMatchArray): boolean =>
    /free\s+bet|token|bonus/i.test(sentenceAround(text, match.index ?? 0));

  const qualifyingMin = minMatches.find((m) => !forFreeBet(m));
  const rewardMin = minMatches.find(forFreeBet);
  const qualifyingMax = maxMatches.find((m) => !forFreeBet(m));
  const rewardMax = maxMatches.find(forFreeBet);

  const toReading = (match: RegExpMatchArray | undefined, what: string): FieldReading<string> => {
    if (!match?.[1]) return unread<string>(`The terms do not state ${what}.`);
    // "evens (2.0)" — prefer the parenthesised decimal when one is given.
    const parenthesised = match[2] ? parseOddsToken(match[2]) : null;
    const parsed = parenthesised ?? parseOddsToken(match[1]);
    if (!parsed) {
      return unread<string>(
        `The terms mention ${what} as "${match[1]}", which could not be read as odds.`,
      );
    }
    return read(parsed, 0.85, match[0]);
  };

  return {
    minQualifying: toReading(qualifyingMin, "minimum odds for the qualifying bet"),
    maxQualifying: toReading(qualifyingMax, "maximum odds for the qualifying bet"),
    minReward: toReading(rewardMin, "minimum odds for the free bet"),
    maxReward: toReading(rewardMax, "maximum odds for the free bet"),
  };
}

function readExpiry(text: string): FieldReading<number> {
  const patterns = [
    /(?:expires?|valid|used?)[^.]{0,40}?(\d+)\s*days?/i,
    /within\s+(\d+)\s*days?/i,
    /(\d+)[\s-]day\s+expiry/i,
  ];
  for (const pattern of patterns) {
    const match = firstMatch(text, pattern);
    if (match?.[1]) return read(Number(match[1]), 0.85, match[0]);
  }
  return unread<number>("The terms do not state how long the free bet lasts.");
}

const SPORTS = [
  "Football",
  "Horse Racing",
  "Tennis",
  "Golf",
  "Cricket",
  "Rugby",
  "Darts",
  "Snooker",
  "Basketball",
  "Greyhounds",
];

function readSports(text: string): FieldReading<string[]> {
  const found: Found[] = [];
  for (const sport of SPORTS) {
    const match = firstMatch(text, new RegExp(sport.replace(/\s+/g, String.raw`\s+`), "i"));
    if (match) found.push({ text: match[0], index: match.index ?? 0 });
  }
  if (found.length > 0) {
    const names = SPORTS.filter((s) =>
      found.some((f) => f.text.toLowerCase().replace(/\s+/g, " ") === s.toLowerCase()),
    );
    return read(names, 0.75, found.map((f) => f.text).join(", "));
  }

  const anySport = firstMatch(text, /any\s+sport|all\s+sports/i);
  if (anySport) return read(["Any"], 0.7, anySport[0]);

  return unread<string[]>("The terms do not restrict the promotion to particular sports.");
}

function readWagering(text: string): FieldReading<string> {
  const match = firstMatch(
    text,
    /(wagering\s+requirement[^.]*|must\s+be\s+wagered[^.]*|rollover[^.]*|\d+\s*x\s+wagering[^.]*)/i,
  );
  if (match) return read(match[0].trim(), 0.7, match[0].trim());
  return unread<string>("The terms do not mention a wagering requirement.");
}

// ---------------------------------------------------------------------------

export interface ParsedTerms {
  reading: PromotionReading;
  confidence: number;
  unreadableFields: ReturnType<typeof scoreReading>["unreadableFields"];
  reasoning: string;
}

export function parsePromotionTerms(title: string, rawText: string): ParsedTerms {
  // The title carries as much of the offer as the body, and often more
  // clearly: "Bet £10 — Get £30 in Free Bets".
  const text = `${title}\n\n${rawText}`;

  const reading = emptyReading();
  reading.kind = readKind(text);
  reading.freeBetType = readFreeBetType(text);
  reading.qualifyingStake = readQualifyingStake(text);
  reading.rewardTotalValue = readRewardTotal(text);

  const tokens = readTokens(text);
  reading.rewardTokenCount = tokens.count;
  reading.rewardTokenValue = tokens.value;

  const odds = readOddsBounds(text);
  reading.minQualifyingOdds = odds.minQualifying;
  reading.maxQualifyingOdds = odds.maxQualifying;
  reading.minRewardOdds = odds.minReward;
  reading.maxRewardOdds = odds.maxReward;

  reading.freeBetExpiryDays = readExpiry(text);
  reading.eligibleSports = readSports(text);
  reading.wageringRequirement = readWagering(text);

  const { confidence, unreadableFields } = scoreReading(reading);

  const reasoning = buildReasoning(reading, unreadableFields);

  return { reading, confidence, unreadableFields, reasoning };
}

function buildReasoning(
  reading: PromotionReading,
  unreadableFields: ReturnType<typeof scoreReading>["unreadableFields"],
): string {
  const lines: string[] = [];

  if (reading.freeBetType.value) {
    lines.push(
      `Free-bet type read as ${reading.freeBetType.value} from "${reading.freeBetType.sourcePhrase}".`,
    );
  } else {
    lines.push(
      `Free-bet type NOT established. ${reading.freeBetType.note ?? ""} A person must decide this.`.trim(),
    );
  }

  const stated = (Object.keys(reading) as Array<keyof PromotionReading>).filter(
    (field) => reading[field].value !== null,
  );
  lines.push(`Read ${stated.length} field${stated.length === 1 ? "" : "s"} from the terms.`);

  if (unreadableFields.length > 0) {
    lines.push(`The terms were silent on: ${unreadableFields.join(", ")}.`);
  }

  return lines.join(" ");
}
