import { NextResponse } from "next/server";
import { z } from "zod";
import {
  D,
  assessLiquidity,
  hedgeFromStrings,
  matchLayStake,
  type LadderLevel,
} from "@/lib/math";
import { serializeHedge, serializeLiquidity, serializeMatch } from "@/lib/serialize";

export const dynamic = "force-dynamic";

const ladderSchema = z.array(z.object({ price: z.string(), size: z.string() })).optional();

const schema = z.object({
  betType: z.enum(["QUALIFYING", "FREE_BET_SNR", "FREE_BET_SR"]),
  backStake: z.string(),
  /**
   * The back price. When the customer has entered the price their own
   * bookmaker is showing, this is that price. Otherwise it is the exchange's
   * indicative price and the response says so.
   */
  backOdds: z.string(),
  layOdds: z.string(),
  commission: z.string(),
  rounding: z.enum(["NEAREST_PENNY", "NEAREST_10P", "NEAREST_50P", "DOWN_PENNY", "UP_PENNY"]),
  /** True when backOdds came from the customer's own bookmaker. */
  backOddsFromBookmaker: z.boolean().default(false),
  ladder: ladderSchema,
});

/**
 * The one calculation endpoint.
 *
 * Every figure it returns comes from lib/math. Nothing here computes anything
 * itself, and every decimal leaves as a string.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const result = hedgeFromStrings({
    betType: input.betType,
    backStake: input.backStake,
    backOdds: input.backOdds,
    layOdds: input.layOdds,
    commission: input.commission,
    rounding: input.rounding,
  });

  if (!result.ok) {
    // Typed errors, so the client can show each one beside its own field.
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 422 });
  }

  const ladder: LadderLevel[] = (input.ladder ?? []).map((level) => ({
    price: new D(level.price),
    size: new D(level.size),
  }));

  const liquidity =
    ladder.length > 0
      ? serializeLiquidity(
          assessLiquidity(ladder, new D(input.layOdds), result.value.layStake),
        )
      : null;

  const partial =
    ladder.length > 0
      ? (() => {
          const matched = matchLayStake(ladder, new D(input.layOdds), result.value.layStake);
          return matched.ok ? serializeMatch(matched.value) : null;
        })()
      : null;

  return NextResponse.json({
    ok: true,
    calculation: serializeHedge(result.value),
    warnings: result.warnings,
    liquidity,
    partialMatch: partial,
    priceBasis: input.backOddsFromBookmaker
      ? "BOOKMAKER_ENTERED"
      : "EXCHANGE_INDICATIVE",
    priceBasisNote: input.backOddsFromBookmaker
      ? "Calculated from the back price you entered from your bookmaker."
      : "Calculated from the exchange's own back price, which is indicative only. Enter the price your bookmaker is showing for this selection before treating this as real.",
  });
}
