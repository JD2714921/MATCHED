"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  approveAutomatedCollection,
  interpretCapture,
  publishPromotion,
  rejectPromotion,
} from "@/lib/promotions/pipeline";
import { prisma } from "@/lib/db";

/**
 * Administration.
 *
 * Every action here requires an administrator and records who did it. Publish
 * is the one that matters: it is the only route to a PUBLISHED promotion in
 * the whole codebase, and it cannot be reached without a person.
 */

export async function publish(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const promotionId = String(formData.get("promotionId") ?? "");
  await publishPromotion(promotionId, admin.id);
  revalidatePath("/admin");
  revalidatePath("/offers");
  revalidatePath("/");
}

export async function reject(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const promotionId = String(formData.get("promotionId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || "No reason given.";
  await rejectPromotion(promotionId, admin.id, reason);
  revalidatePath("/admin");
  revalidatePath("/offers");
}

export async function reinterpret(formData: FormData): Promise<void> {
  await requireAdmin();
  const captureId = String(formData.get("captureId") ?? "");
  await interpretCapture(captureId);
  revalidatePath("/admin");
}

export async function unpublish(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const promotionId = String(formData.get("promotionId") ?? "");
  await prisma.promotion.update({
    where: { id: promotionId },
    data: { status: "NEEDS_VERIFICATION", publishedAt: null, publishedById: null },
  });
  await prisma.auditLog.create({
    data: {
      actorUserId: admin.id,
      action: "PROMOTION_UNPUBLISHED",
      entityType: "Promotion",
      entityId: promotionId,
    },
  });
  revalidatePath("/admin");
  revalidatePath("/offers");
  revalidatePath("/");
}

export async function setSourceApproval(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  await approveAutomatedCollection({
    sourceId: String(formData.get("sourceId") ?? ""),
    userId: admin.id,
    robotsTxtAllows: String(formData.get("robotsTxtAllows") ?? "no") === "yes",
    approvalNote: String(formData.get("approvalNote") ?? "").trim() || "No note given.",
  });
  revalidatePath("/admin/sources");
}
