"use server";

import { revalidatePath } from "next/cache";
import { Prisma, prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { realisedResult } from "@/lib/bets";

/**
 * Recording what actually happened.
 *
 * Every figure the customer submits here overwrites a suggestion, and the
 * realised result is computed only from these. Nothing in this file falls back
 * to a calculated figure to make a record look tidier.
 */

async function ownedPlan(planId: string) {
  const user = await requireUser();
  const plan = await prisma.betPlan.findFirst({
    where: { id: planId, userId: user.id },
    include: { legs: true },
  });
  if (!plan) throw new Error("No such position.");
  return { user, plan };
}

function decimalOrNull(value: FormDataEntryValue | null): Prisma.Decimal | null {
  if (value === null) return null;
  const text = String(value).trim().replace(/^£/, "").replace(/,/g, "");
  if (text === "") return null;
  try {
    const decimal = new Prisma.Decimal(text);
    return decimal.isNaN() ? null : decimal;
  } catch {
    return null;
  }
}

/**
 * Settle one stage of a position from the figures the customer actually got.
 *
 * `selectionWon` decides both legs at once: if the backed selection won, the
 * back leg won and the lay leg lost, and vice versa. They cannot disagree.
 */
export async function settleStage(formData: FormData): Promise<void> {
  const planId = String(formData.get("planId") ?? "");
  const stage = String(formData.get("stage") ?? "QUALIFYING") as "QUALIFYING" | "CONVERSION";
  const selectionWon = String(formData.get("selectionWon") ?? "no") === "yes";

  const { user, plan } = await ownedPlan(planId);
  const legs = plan.legs.filter((leg) => leg.stage === stage);
  const now = new Date();

  for (const leg of legs) {
    const prefix = `${leg.side.toLowerCase()}_`;
    const actualStake = decimalOrNull(formData.get(`${prefix}stake`));
    const actualOdds = decimalOrNull(formData.get(`${prefix}odds`));
    const commissionRate = decimalOrNull(formData.get(`${prefix}commission`));

    const won = leg.side === "BACK" ? selectionWon : !selectionWon;

    await prisma.betLeg.update({
      where: { id: leg.id },
      data: {
        ...(actualStake ? { actualStake } : {}),
        ...(actualOdds ? { actualOdds } : {}),
        ...(commissionRate ? { commissionRate } : {}),
        outcome: won ? "WON" : "LOST",
        placedAt: leg.placedAt ?? now,
        settledAt: now,
      },
    });
  }

  await prisma.betPlan.update({
    where: { id: plan.id },
    data: { status: stage === "QUALIFYING" ? "QUALIFYING_SETTLED" : "CONVERSION_PLACED" },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "BET_STAGE_SETTLED",
      entityType: "BetPlan",
      entityId: plan.id,
      detail: { stage, selectionWon },
    },
  });

  revalidatePath(`/bets/${plan.id}`);
  revalidatePath("/bets");
  revalidatePath("/");
}

/** The token has landed in the customer's account. */
export async function recordTokenReceived(formData: FormData): Promise<void> {
  const planId = String(formData.get("planId") ?? "");
  const { user, plan } = await ownedPlan(planId);

  await prisma.betPlan.update({ where: { id: plan.id }, data: { status: "TOKEN_RECEIVED" } });

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "TOKEN_RECEIVED",
      entityType: "BetPlan",
      entityId: plan.id,
    },
  });

  revalidatePath(`/bets/${plan.id}`);
  revalidatePath("/bets");
  revalidatePath("/");
}

/**
 * Close a position and write its realised result.
 *
 * The figure written is the sum of the legs as they actually settled. If any
 * leg is unsettled, nothing is written — an incomplete position has no result.
 */
export async function completePlan(formData: FormData): Promise<void> {
  const planId = String(formData.get("planId") ?? "");
  const { user, plan } = await ownedPlan(planId);

  const result = realisedResult(plan.legs);
  if (!result.complete || !result.net) {
    throw new Error("Every leg must be settled before a position can be completed.");
  }

  await prisma.betPlan.update({
    where: { id: plan.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      realisedNet: new Prisma.Decimal(result.net.toFixed(2)),
    },
  });

  // One ledger entry per stage, so the profit record can separate the cost of
  // qualifying from the value of the conversion.
  const stages: Array<"QUALIFYING" | "CONVERSION"> = ["QUALIFYING", "CONVERSION"];
  for (const stage of stages) {
    const stageLegs = plan.legs.filter((leg) => leg.stage === stage);
    if (stageLegs.length === 0) continue;
    const stageResult = realisedResult(stageLegs);
    if (!stageResult.net) continue;

    await prisma.ledgerEntry.create({
      data: {
        userId: user.id,
        betPlanId: plan.id,
        kind: stage === "QUALIFYING" ? "QUALIFYING_LOSS" : "TOKEN_CONVERSION",
        amount: new Prisma.Decimal(stageResult.net.toFixed(2)),
        description:
          stage === "QUALIFYING"
            ? `Qualifying bet on ${plan.selectionName}`
            : `Token conversion on ${plan.selectionName}`,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "BET_PLAN_COMPLETED",
      entityType: "BetPlan",
      entityId: plan.id,
      detail: { realisedNet: result.net.toFixed(2) },
    },
  });

  revalidatePath(`/bets/${plan.id}`);
  revalidatePath("/bets");
  revalidatePath("/profit");
  revalidatePath("/");
}

export async function abandonPlan(formData: FormData): Promise<void> {
  const planId = String(formData.get("planId") ?? "");
  const { user, plan } = await ownedPlan(planId);

  await prisma.betPlan.update({ where: { id: plan.id }, data: { status: "ABANDONED" } });
  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "BET_PLAN_ABANDONED",
      entityType: "BetPlan",
      entityId: plan.id,
    },
  });

  revalidatePath(`/bets/${plan.id}`);
  revalidatePath("/bets");
  revalidatePath("/");
}
