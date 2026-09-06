import { createHash } from "node:crypto";
import type { CollectionMethod, PromotionSource } from "@prisma/client";
import { prisma, Prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { getAiProvider } from "@/lib/ai";
import {
  REVIEW_READY_CONFIDENCE,
  type InterpretResult,
  type PromotionReading,
} from "@/lib/ai/types";

const log = childLogger("promotions");

/**
 * The promotion pipeline.
 *
 *   collect -> store raw verbatim -> interpret -> validate -> confidence gate
 *           -> HUMAN VERIFICATION -> published
 *
 * The last arrow is the one that matters. An interpretation NEVER publishes an
 * offer. `publishPromotion` requires a user id and is the only function in the
 * codebase that can set status to PUBLISHED; the confidence gate decides only
 * how much work the reviewer has to do, not whether a reviewer is needed.
 */

export class CollectionNotApprovedError extends Error {
  readonly sourceId: string;

  constructor(source: PromotionSource) {
    super(
      `Automated collection is not approved for source "${source.name}". An administrator must record a robots.txt check and a terms-of-use review before this source can be collected from automatically.`,
    );
    this.name = "CollectionNotApprovedError";
    this.sourceId = source.id;
  }
}

/** Methods that reach out to someone else's server on our schedule. */
const AUTOMATED_METHODS: CollectionMethod[] = ["PUBLIC_PAGE_FETCH", "PARTNER_API"];

export function requiresCollectionApproval(method: CollectionMethod): boolean {
  return AUTOMATED_METHODS.includes(method);
}

/**
 * May this source be collected from without a person present?
 *
 * Manual entry and a feed the operator sends us are always fine. Anything that
 * fetches from an operator's own site is off until an administrator has
 * recorded both checks — which is why the flag defaults to false in the schema.
 */
export function canCollectAutomatically(source: PromotionSource): {
  allowed: boolean;
  reason: string;
} {
  if (!source.enabled) {
    return { allowed: false, reason: "The source is disabled." };
  }
  if (!requiresCollectionApproval(source.collectionMethod)) {
    return {
      allowed: true,
      reason:
        source.collectionMethod === "MANUAL_ENTRY"
          ? "Entered by hand; nothing is fetched."
          : "Supplied by the operator, not fetched from their site.",
    };
  }
  if (!source.automatedCollectionApproved) {
    return {
      allowed: false,
      reason: "Automated collection has not been approved for this source.",
    };
  }
  if (!source.robotsTxtCheckedAt) {
    return { allowed: false, reason: "No robots.txt check has been recorded." };
  }
  if (source.robotsTxtAllows === false) {
    return { allowed: false, reason: "The site's robots.txt disallows this path." };
  }
  if (!source.termsReviewedAt) {
    return { allowed: false, reason: "No terms-of-use review has been recorded." };
  }
  return { allowed: true, reason: "Approved: robots.txt checked and terms reviewed." };
}

export function contentHash(title: string, rawText: string): string {
  return createHash("sha256").update(`${title}\n${rawText}`).digest("hex");
}

export interface CollectInput {
  sourceId: string;
  title: string;
  /** The operator's own words. Stored exactly as given. */
  rawText: string;
  sourceUrl?: string;
}

/**
 * Store a capture verbatim.
 *
 * Nothing is normalised, trimmed of meaning or tidied. The admin screen shows
 * this text beside the reading of it so a person can see what changed.
 */
export async function collectCapture(input: CollectInput) {
  const source = await prisma.promotionSource.findUnique({ where: { id: input.sourceId } });
  if (!source) throw new Error(`No promotion source ${input.sourceId}.`);

  const permission = canCollectAutomatically(source);
  if (requiresCollectionApproval(source.collectionMethod) && !permission.allowed) {
    throw new CollectionNotApprovedError(source);
  }

  const hash = contentHash(input.title, input.rawText);

  const existing = await prisma.rawPromotionCapture.findFirst({
    where: { sourceId: source.id, contentHash: hash },
  });
  if (existing) return existing;

  const capture = await prisma.rawPromotionCapture.create({
    data: {
      sourceId: source.id,
      rawTitle: input.title,
      rawText: input.rawText,
      contentHash: hash,
      sourceUrl: input.sourceUrl ?? source.url ?? null,
    },
  });

  await prisma.promotionSource.update({
    where: { id: source.id },
    data: { lastCollectedAt: new Date() },
  });

  return capture;
}

/** Decimal or null, without letting a bad string become NaN in the database. */
function toDecimal(value: string | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const decimal = new Prisma.Decimal(value);
    return decimal.isNaN() ? null : decimal;
  } catch {
    return null;
  }
}

function toInt(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isInteger(value) ? value : null;
}

/**
 * Turn a reading into the fields of a promotion.
 *
 * A field the reading left null stays null in the database. Nothing is
 * defaulted on the way in — the gap has to survive all the way to the
 * reviewer's screen to be useful.
 */
export function readingToPromotionFields(reading: PromotionReading) {
  return {
    kind: (reading.kind.value ?? "OTHER") as "OTHER",
    qualifyingStake: toDecimal(reading.qualifyingStake.value),
    minQualifyingOdds: toDecimal(reading.minQualifyingOdds.value),
    maxQualifyingOdds: toDecimal(reading.maxQualifyingOdds.value),
    rewardTotalValue: toDecimal(reading.rewardTotalValue.value),
    rewardTokenCount: toInt(reading.rewardTokenCount.value),
    rewardTokenValue: toDecimal(reading.rewardTokenValue.value),
    // An unread free-bet type is UNKNOWN, not a guess at the common case.
    freeBetType: (reading.freeBetType.value ?? "UNKNOWN") as "UNKNOWN",
    freeBetExpiryDays: toInt(reading.freeBetExpiryDays.value),
    minRewardOdds: toDecimal(reading.minRewardOdds.value),
    maxRewardOdds: toDecimal(reading.maxRewardOdds.value),
    eligibleSports: reading.eligibleSports.value ?? [],
    wageringRequirement: reading.wageringRequirement.value,
  };
}

export interface ValidationIssue {
  field: string;
  severity: "BLOCKING" | "WARNING";
  message: string;
}

/**
 * Sanity-check a reading before it reaches a reviewer.
 *
 * BLOCKING issues are things that would make a calculation wrong or
 * meaningless. They do not stop a person publishing — a person can see the raw
 * text and decide — but they are shown prominently.
 */
export function validateReading(reading: PromotionReading): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (reading.freeBetType.value === null) {
    issues.push({
      field: "freeBetType",
      severity: "BLOCKING",
      message:
        "Whether the free-bet stake is returned was not established. Its value cannot be calculated without it.",
    });
  }

  if (reading.rewardTotalValue.value === null && reading.rewardTokenValue.value === null) {
    issues.push({
      field: "rewardTotalValue",
      severity: "BLOCKING",
      message: "No reward value was read, so there is nothing to calculate a return on.",
    });
  }

  const count = reading.rewardTokenCount.value;
  const perToken = reading.rewardTokenValue.value;
  const total = reading.rewardTotalValue.value;
  if (count !== null && perToken !== null && total !== null) {
    const implied = Number(perToken) * count;
    if (Math.abs(implied - Number(total)) > 0.005) {
      issues.push({
        field: "rewardTokenCount",
        severity: "WARNING",
        message: `The token split does not match the stated total: ${count} × ${perToken} is not ${total}.`,
      });
    }
  }

  const minQ = reading.minQualifyingOdds.value;
  const maxQ = reading.maxQualifyingOdds.value;
  if (minQ !== null && maxQ !== null && Number(minQ) > Number(maxQ)) {
    issues.push({
      field: "minQualifyingOdds",
      severity: "BLOCKING",
      message: "The minimum qualifying odds are above the maximum.",
    });
  }

  if (reading.qualifyingStake.value === null && reading.kind.value !== "ODDS_BOOST") {
    issues.push({
      field: "qualifyingStake",
      severity: "WARNING",
      message: "No qualifying stake was read, so the capital needed cannot be shown up front.",
    });
  }

  if (reading.freeBetExpiryDays.value === null) {
    issues.push({
      field: "freeBetExpiryDays",
      severity: "WARNING",
      message: "No expiry was read. Tokens that expire unnoticed are worth nothing.",
    });
  }

  return issues;
}

export interface InterpretationOutcome {
  promotionId: string;
  interpretationId: string;
  confidence: number;
  reviewReady: boolean;
  issues: ValidationIssue[];
  result: InterpretResult;
}

/**
 * Interpret a capture and create or update the promotion behind it.
 *
 * The status set here is NEVER `PUBLISHED`. It is `NEEDS_VERIFICATION`
 * regardless of confidence, because only a person publishes.
 */
export async function interpretCapture(captureId: string): Promise<InterpretationOutcome> {
  const capture = await prisma.rawPromotionCapture.findUnique({
    where: { id: captureId },
    include: { source: { include: { operator: true } } },
  });
  if (!capture) throw new Error(`No capture ${captureId}.`);

  const provider = getAiProvider();
  const result = await provider.interpretPromotion({
    title: capture.rawTitle ?? "",
    rawText: capture.rawText,
    operatorName: capture.source.operator.name,
    ...(capture.sourceUrl ? { sourceUrl: capture.sourceUrl } : {}),
  });

  const issues = validateReading(result.reading);
  const reviewReady =
    result.confidence >= REVIEW_READY_CONFIDENCE &&
    !issues.some((issue) => issue.severity === "BLOCKING");

  const fields = readingToPromotionFields(result.reading);

  const existing = await prisma.promotion.findFirst({ where: { rawCaptureId: capture.id } });

  const promotion = existing
    ? await prisma.promotion.update({
        where: { id: existing.id },
        data: {
          ...fields,
          // An already-published promotion is not silently rewritten by a
          // re-read; it goes back to a person.
          status: existing.status === "PUBLISHED" ? "NEEDS_VERIFICATION" : existing.status,
        },
      })
    : await prisma.promotion.create({
        data: {
          ...fields,
          operatorId: capture.source.operatorId,
          sourceId: capture.sourceId,
          rawCaptureId: capture.id,
          title: capture.rawTitle ?? "Untitled promotion",
          status: "NEEDS_VERIFICATION",
        },
      });

  const interpretation = await prisma.promotionInterpretation.create({
    data: {
      promotionId: promotion.id,
      providerName: result.providerName,
      providerModel: result.providerModel,
      confidence: new Prisma.Decimal(result.confidence.toFixed(4)),
      fields: result.reading as unknown as Prisma.InputJsonValue,
      unreadableFields: result.unreadableFields,
      reasoning: result.reasoning,
      numericGuardFired: result.numericGuardFired,
      numericGuardDetail: result.numericGuardDetail,
      latencyMs: result.latencyMs,
    },
  });

  log.info(
    { promotionId: promotion.id, confidence: result.confidence, reviewReady },
    "promotion interpreted",
  );

  return {
    promotionId: promotion.id,
    interpretationId: interpretation.id,
    confidence: result.confidence,
    reviewReady,
    issues,
    result,
  };
}

/**
 * Publish a promotion.
 *
 * THE ONLY PATH TO PUBLISHED. It requires the id of the person doing it, and
 * that person is recorded on the promotion and in the audit log. No automated
 * process calls this.
 */
export async function publishPromotion(promotionId: string, userId: string) {
  const now = new Date();
  const promotion = await prisma.promotion.update({
    where: { id: promotionId },
    data: {
      status: "PUBLISHED",
      publishedAt: now,
      publishedById: userId,
      verifiedAt: now,
      verifiedById: userId,
      rejectionReason: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "PROMOTION_PUBLISHED",
      entityType: "Promotion",
      entityId: promotionId,
      detail: { title: promotion.title },
    },
  });

  return promotion;
}

export async function rejectPromotion(promotionId: string, userId: string, reason: string) {
  const promotion = await prisma.promotion.update({
    where: { id: promotionId },
    data: { status: "REJECTED", rejectionReason: reason, verifiedAt: new Date(), verifiedById: userId },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "PROMOTION_REJECTED",
      entityType: "Promotion",
      entityId: promotionId,
      detail: { reason },
    },
  });

  return promotion;
}

/**
 * Approve automated collection for a source.
 *
 * Both checks are required arguments, so the flag cannot be flipped without
 * someone stating what they checked.
 */
export async function approveAutomatedCollection(args: {
  sourceId: string;
  userId: string;
  robotsTxtAllows: boolean;
  approvalNote: string;
}) {
  const now = new Date();
  const source = await prisma.promotionSource.update({
    where: { id: args.sourceId },
    data: {
      automatedCollectionApproved: args.robotsTxtAllows,
      robotsTxtCheckedAt: now,
      robotsTxtCheckedBy: args.userId,
      robotsTxtAllows: args.robotsTxtAllows,
      termsReviewedAt: now,
      termsReviewedBy: args.userId,
      approvalNote: args.approvalNote,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: args.userId,
      action: args.robotsTxtAllows ? "SOURCE_COLLECTION_APPROVED" : "SOURCE_COLLECTION_REFUSED",
      entityType: "PromotionSource",
      entityId: args.sourceId,
      detail: { robotsTxtAllows: args.robotsTxtAllows, note: args.approvalNote },
    },
  });

  return source;
}
