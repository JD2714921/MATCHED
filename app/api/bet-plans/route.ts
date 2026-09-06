import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, Prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  promotionId: z.string(),
  stage: z.enum(["QUALIFYING", "CONVERSION"]),
  eventName: z.string().min(1),
  marketName: z.string().min(1),
  selectionName: z.string().min(1),
  eventStartsAt: z.string().nullable().optional(),
  betType: z.enum(["QUALIFYING", "FREE_BET_SNR", "FREE_BET_SR"]),
  backStake: z.string(),
  backOdds: z.string(),
  layStake: z.string(),
  layOdds: z.string(),
  commission: z.string(),
  liability: z.string(),
  plannedNet: z.string(),
  plannedRating: z.string(),
});

/**
 * Record a calculated position.
 *
 * The figures stored are the SUGGESTED ones. The customer edits them to what
 * they actually got, and every profit figure is computed from those instead —
 * lays fill worse than the screen showed, and the record should say so.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to record a position." }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]!.message }, { status: 400 });
  }
  const input = parsed.data;

  const promotion = await prisma.promotion.findUnique({ where: { id: input.promotionId } });
  if (!promotion || promotion.status !== "PUBLISHED") {
    return NextResponse.json({ error: "That offer is not published." }, { status: 400 });
  }

  const existing =
    input.stage === "CONVERSION"
      ? await prisma.betPlan.findFirst({
          where: {
            userId: user.id,
            promotionId: promotion.id,
            status: { in: ["TOKEN_RECEIVED", "QUALIFYING_SETTLED"] },
          },
          orderBy: { createdAt: "desc" },
        })
      : null;

  const plan =
    existing ??
    (await prisma.betPlan.create({
      data: {
        userId: user.id,
        promotionId: promotion.id,
        operatorId: promotion.operatorId,
        eventName: input.eventName,
        marketName: input.marketName,
        selectionName: input.selectionName,
        eventStartsAt: input.eventStartsAt ? new Date(input.eventStartsAt) : null,
        plannedNet: new Prisma.Decimal(input.plannedNet),
        plannedRating: new Prisma.Decimal(input.plannedRating),
        status: "PLANNED",
      },
    }));

  await prisma.betLeg.createMany({
    data: [
      {
        betPlanId: plan.id,
        stage: input.stage,
        side: "BACK",
        betType: input.betType,
        suggestedStake: new Prisma.Decimal(input.backStake),
        suggestedOdds: new Prisma.Decimal(input.backOdds),
        venue: promotion.title,
      },
      {
        betPlanId: plan.id,
        stage: input.stage,
        side: "LAY",
        betType: input.betType,
        suggestedStake: new Prisma.Decimal(input.layStake),
        suggestedOdds: new Prisma.Decimal(input.layOdds),
        commissionRate: new Prisma.Decimal(input.commission),
        liability: new Prisma.Decimal(input.liability),
        venue: "Exchange",
      },
    ],
  });

  if (existing) {
    await prisma.betPlan.update({
      where: { id: plan.id },
      data: {
        status: "CONVERSION_PLACED",
        selectionName: input.selectionName,
        eventName: input.eventName,
        marketName: input.marketName,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "BET_PLAN_RECORDED",
      entityType: "BetPlan",
      entityId: plan.id,
      detail: { stage: input.stage, plannedNet: input.plannedNet },
    },
  });

  return NextResponse.json({ id: plan.id });
}
