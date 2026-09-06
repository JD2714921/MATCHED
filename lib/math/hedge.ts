import {
  ZERO,
  money,
  parseDecimal,
  roundStake,
  sum,
  minOf,
  maxOf,
  type Decimal,
} from "./decimal";
import type {
  BetType,
  HedgeInput,
  HedgeResult,
  Outcome,
  OutcomeResult,
  SettlementLine,
} from "./types";
import { ok, err, type EngineResult, type EngineWarning } from "./errors";
import { validateHedgeInput } from "./validate";

/**
 * The equalising lay stake, before rounding.
 *
 *   qualifying / stake-returned free bet:  S = B*b     / (l - c)
 *   stake-not-returned free bet:           S = B*(b-1) / (l - c)
 *
 * The numerator is simply "what the back bet returns to you if it wins", which
 * is why SNR differs: the token's face value is never handed back.
 */
export function idealLayStake(input: HedgeInput): Decimal {
  const { betType, backStake, backOdds, layOdds, commission } = input;
  const denominator = layOdds.minus(commission);
  const numerator = backReturnIfWins(betType, backStake, backOdds);
  return numerator.dividedBy(denominator);
}

/** What the bookmaker hands back when the back bet wins, in total. */
function backReturnIfWins(betType: BetType, backStake: Decimal, backOdds: Decimal): Decimal {
  switch (betType) {
    case "QUALIFYING":
    case "FREE_BET_SR":
      return backStake.times(backOdds);
    case "FREE_BET_SNR":
      return backStake.times(backOdds.minus(1));
  }
}

/**
 * Build one outcome from its cash flows.
 *
 * Every line is rounded to pence FIRST, and the net is then the sum of those
 * rounded lines. This is what makes the settlement matrix a proof rather than a
 * restatement: a customer can add the column up by hand and get our number.
 */
function buildOutcome(
  outcome: Outcome,
  label: string,
  rawLines: SettlementLine[],
): OutcomeResult {
  const lines = rawLines.map((line) => ({ ...line, amount: money(line.amount) }));
  return { outcome, label, lines, net: sum(lines.map((l) => l.amount)) };
}

export function calculateHedge(input: HedgeInput): EngineResult<HedgeResult> {
  const errors = validateHedgeInput(input);
  if (errors.length > 0) return err(errors);

  const { betType, backStake: B, backOdds: b, layOdds: l, commission: c } = input;

  const ideal = idealLayStake(input);
  const S = roundStake(ideal, input.rounding);

  // Every downstream figure derives from S, the stake the customer can actually
  // place — never from `ideal`.
  const liability = money(S.times(l.minus(1)));
  const commissionPaid = money(S.times(c));
  const isFreeBet = betType !== "QUALIFYING";

  const backWinsLines: SettlementLine[] = [];
  const backLosesLines: SettlementLine[] = [];

  if (isFreeBet) {
    const tokenNote =
      betType === "FREE_BET_SNR"
        ? "The token costs you nothing and its face value is not returned."
        : "The token costs you nothing; its face value is returned with any winnings.";
    backWinsLines.push({
      label: "Free bet token",
      amount: ZERO,
      venue: "NONE",
      note: tokenNote,
    });
    backLosesLines.push({
      label: "Free bet token",
      amount: ZERO,
      venue: "NONE",
      note: "The token is used up whether it wins or loses.",
    });
  } else {
    backWinsLines.push({
      label: "Back stake placed",
      amount: B.negated(),
      venue: "BOOKMAKER",
      note: "Your own money, staked at the bookmaker.",
    });
    backLosesLines.push({
      label: "Back stake placed",
      amount: B.negated(),
      venue: "BOOKMAKER",
      note: "Your own money, staked at the bookmaker.",
    });
  }

  // --- Back bet wins -----------------------------------------------------
  backWinsLines.push({
    label:
      betType === "FREE_BET_SNR"
        ? "Bookmaker pays winnings only"
        : "Bookmaker returns stake and winnings",
    amount: backReturnIfWins(betType, B, b),
    venue: "BOOKMAKER",
    note: `${B.toFixed(2)} at ${b.toFixed(2)}`,
  });
  backWinsLines.push({
    label: "Lay bet loses — liability paid",
    amount: liability.negated(),
    venue: "EXCHANGE",
    note: `${S.toFixed(2)} × (${l.toFixed(2)} − 1)`,
  });

  // --- Back bet loses ----------------------------------------------------
  backLosesLines.push({
    label: "Lay bet wins — you keep the backer's stake",
    amount: S,
    venue: "EXCHANGE",
  });
  backLosesLines.push({
    label: "Exchange commission on winnings",
    amount: commissionPaid.negated(),
    venue: "EXCHANGE",
    note: `${c.times(100).toFixed(2)}% of ${S.toFixed(2)}`,
  });

  const backWins = buildOutcome(
    "BACK_WINS",
    "Your selection wins at the bookmaker",
    backWinsLines,
  );
  const backLoses = buildOutcome(
    "BACK_LOSES",
    "Your selection does not win — the lay bet wins",
    backLosesLines,
  );

  const guaranteedNet = minOf(backWins.net, backLoses.net);
  const bestCaseNet = maxOf(backWins.net, backLoses.net);
  const outcomeSpread = bestCaseNet.minus(guaranteedNet);

  // A qualifying bet is rated by how much of your stake survives; a free bet by
  // how much of the token's face value you convert into real money.
  const rating = isFreeBet
    ? guaranteedNet.dividedBy(B).times(100)
    : B.plus(guaranteedNet).dividedBy(B).times(100);

  const result: HedgeResult = {
    input,
    idealLayStake: ideal,
    layStake: S,
    liability,
    backWins,
    backLoses,
    guaranteedNet,
    bestCaseNet,
    outcomeSpread,
    rating: rating.toDecimalPlaces(2),
    exchangeCapitalRequired: liability,
    bookmakerCapitalRequired: isFreeBet ? ZERO : B,
  };

  return ok(result, collectWarnings(result));
}

function collectWarnings(result: HedgeResult): EngineWarning[] {
  const warnings: EngineWarning[] = [];
  const { input, layStake, outcomeSpread, guaranteedNet } = result;
  const { backOdds: b, layOdds: l, betType } = input;

  if (l.lessThan(b)) {
    warnings.push({
      code: "LAY_SHORTER_THAN_BACK",
      message:
        "The lay price is shorter than the back price. Check both prices are for the same selection and the same market before placing anything.",
    });
  } else if (l.minus(b).dividedBy(b).greaterThan("0.15")) {
    warnings.push({
      code: "EXTREME_ODDS_GAP",
      message:
        "The exchange price is much worse than the bookmaker price. The cost of qualifying will be high.",
    });
  }

  if (outcomeSpread.greaterThan("0.25")) {
    warnings.push({
      code: "LARGE_OUTCOME_SPREAD",
      message: `Rounding leaves ${outcomeSpread.toFixed(2)} between the two outcomes. A finer rounding mode would even them out.`,
    });
  }

  if (betType !== "QUALIFYING" && guaranteedNet.isNegative()) {
    warnings.push({
      code: "NEGATIVE_FREE_BET_RETURN",
      message: "At these prices this token converts to a loss. Look for a closer pair of prices.",
    });
  }

  if (layStake.lessThan("2")) {
    warnings.push({
      code: "VERY_LOW_STAKE",
      message: "The lay stake is below the minimum most exchanges accept.",
    });
  }

  return warnings;
}

/**
 * Convenience wrapper for callers holding primitives. Strings only — accepting
 * a JS number here would be the one place a float could enter the engine.
 */
export function hedgeFromStrings(args: {
  betType: BetType;
  backStake: string;
  backOdds: string;
  layOdds: string;
  commission: string;
  rounding: HedgeInput["rounding"];
}): EngineResult<HedgeResult> {
  return calculateHedge({
    betType: args.betType,
    backStake: parseDecimal(args.backStake),
    backOdds: parseDecimal(args.backOdds),
    layOdds: parseDecimal(args.layOdds),
    commission: parseDecimal(args.commission),
    rounding: args.rounding,
  });
}
