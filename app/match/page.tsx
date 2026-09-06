import { prisma } from "@/lib/db";
import { D } from "@/lib/math";
import { asMoney, asOdds } from "@/lib/serialize";
import { betTypeForPromotion, tokenFaceValue } from "@/lib/opportunities";
import { PageHeader, Note } from "@/components/ui";
import { MatchFinder } from "@/components/match-finder";
import type { OfferOption } from "@/components/match-engine";

export const dynamic = "force-dynamic";

/**
 * Match Finder.
 *
 * Each published promotion contributes up to two entries: the qualifying bet
 * that unlocks the token, and the conversion of the token itself. They are
 * separate calculations with different bet types, different stakes and
 * different minimum odds, so they are separate rows rather than a mode toggle.
 */
export default async function MatchPage({
  searchParams,
}: {
  searchParams: Promise<{ promotion?: string; stage?: string }>;
}) {
  const params = await searchParams;

  const promotions = await prisma.promotion.findMany({
    where: { status: "PUBLISHED" },
    include: {
      operator: true,
      interpretations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });

  const offers: OfferOption[] = [];

  for (const promotion of promotions) {
    const confidence = promotion.interpretations[0]
      ? Number(promotion.interpretations[0].confidence)
      : 0;

    if (promotion.qualifyingStake) {
      offers.push({
        promotionId: promotion.id,
        operatorName: promotion.operator.name,
        title: promotion.title,
        betType: "QUALIFYING",
        freeBetType: promotion.freeBetType,
        stake: asMoney(new D(promotion.qualifyingStake.toString())),
        minOdds: promotion.minQualifyingOdds
          ? asOdds(new D(promotion.minQualifyingOdds.toString()))
          : null,
        stage: "QUALIFYING",
        termsConfidence: confidence,
      });
    }

    const faceValue = tokenFaceValue(promotion);
    // A token whose type was not established cannot be valued, so it is not
    // offered as something to calculate.
    if (faceValue && promotion.freeBetType !== "UNKNOWN") {
      offers.push({
        promotionId: promotion.id,
        operatorName: promotion.operator.name,
        title: promotion.title,
        betType: betTypeForPromotion(promotion),
        freeBetType: promotion.freeBetType,
        stake: asMoney(faceValue),
        minOdds: promotion.minRewardOdds
          ? asOdds(new D(promotion.minRewardOdds.toString()))
          : null,
        stage: "CONVERSION",
        termsConfidence: confidence,
      });
    }
  }

  const requestedStage = params.stage === "CONVERSION" ? "CONVERSION" : "QUALIFYING";
  const initialOfferKey = params.promotion ? `${params.promotion}:${requestedStage}` : null;

  return (
    <>
      <PageHeader
        title="Match Finder"
        lede="Pick an offer, find a market on the exchange, then enter the price your own bookmaker is showing before treating anything as real."
      />

      <div className="mb-4">
        <Note tone="caution">
          <span className="font-medium">There is no bookmaker odds feed in this product.</span>{" "}
          Back prices shown against a market are the exchange&rsquo;s own, used to find a workable
          selection. They are marked <span className="font-medium">indicative</span> until you
          enter what your bookmaker is quoting for that exact selection.
        </Note>
      </div>

      <MatchFinder offers={offers} initialOfferKey={initialOfferKey} />
    </>
  );
}
