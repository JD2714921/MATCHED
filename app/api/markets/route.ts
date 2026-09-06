import { NextResponse } from "next/server";
import { z } from "zod";
import {
  D,
  DEFAULT_ROUNDING,
  assessLiquidity,
  bestBackPrice,
  bestLayPrice,
  calculateHedge,
  type BetType,
} from "@/lib/math";
import { getExchangeProvider } from "@/lib/exchange";
import { serializeHedge, serializeLiquidity, asOdds } from "@/lib/serialize";

export const dynamic = "force-dynamic";

const schema = z.object({
  betType: z.enum(["QUALIFYING", "FREE_BET_SNR", "FREE_BET_SR"]),
  stake: z.string(),
  commission: z.string().default("0.05"),
  minOdds: z.string().nullable().optional(),
  search: z.string().nullable().optional(),
});

/**
 * Search the exchange for markets compatible with an offer.
 *
 * Every row carries `indicativeBackPrice` — the EXCHANGE's own back price. It
 * is a starting point for finding a market, not a bookmaker's price, and the
 * client labels it as such wherever it appears.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = schema.safeParse({
    betType: url.searchParams.get("betType") ?? "QUALIFYING",
    stake: url.searchParams.get("stake") ?? "10",
    commission: url.searchParams.get("commission") ?? "0.05",
    minOdds: url.searchParams.get("minOdds"),
    search: url.searchParams.get("search"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]!.message }, { status: 400 });
  }

  const { betType, stake, commission, minOdds, search } = parsed.data;
  const provider = getExchangeProvider();

  const events = await provider.getEvents({
    limit: 10,
    ...(search ? { search } : {}),
  });

  const rows: unknown[] = [];

  for (const event of events) {
    const markets = await provider.getMarkets(event.id);
    if (markets.length === 0) continue;
    const priced = await provider.getPrices(markets.map((m) => m.id));

    for (const marketPrices of priced) {
      const market = markets.find((m) => m.id === marketPrices.marketId);
      if (!market) continue;

      for (const selection of marketPrices.selections) {
        const backPrice = bestBackPrice(selection.availableToBack);
        const layPrice = bestLayPrice(selection.availableToLay);
        if (!backPrice || !layPrice) continue;
        if (minOdds && backPrice.lessThan(new D(minOdds))) continue;

        const calculated = calculateHedge({
          betType: betType as BetType,
          backStake: new D(stake),
          backOdds: backPrice,
          layOdds: layPrice,
          commission: new D(commission),
          rounding: DEFAULT_ROUNDING,
        });
        if (!calculated.ok) continue;

        rows.push({
          eventId: event.id,
          eventName: event.name,
          competition: event.competition,
          eventStartsAt: event.startsAt.toISOString(),
          marketId: market.id,
          marketName: market.name,
          selectionId: selection.selectionId,
          selectionName: selection.selectionName,
          indicativeBackPrice: asOdds(backPrice),
          bestLayPrice: asOdds(layPrice),
          isMarketDataDelayed: marketPrices.isMarketDataDelayed,
          tradedVolumeAvailable: marketPrices.tradedVolumeAvailable,
          totalMatched:
            selection.totalMatched === null ? null : selection.totalMatched.toFixed(2),
          liquidity: serializeLiquidity(
            assessLiquidity(selection.availableToLay, layPrice, calculated.value.layStake),
          ),
          layLadder: selection.availableToLay.map((level) => ({
            price: asOdds(level.price),
            size: level.size.toFixed(2),
          })),
          calculation: serializeHedge(calculated.value),
        });
      }
    }
  }

  rows.sort(
    (a, b) =>
      Number((b as { calculation: { guaranteedNet: string } }).calculation.guaranteedNet) -
      Number((a as { calculation: { guaranteedNet: string } }).calculation.guaranteedNet),
  );

  const health = await provider.healthCheck();

  return NextResponse.json({
    provider: provider.name,
    live: health.live,
    providerMessage: health.message,
    rows: rows.slice(0, 40),
  });
}
