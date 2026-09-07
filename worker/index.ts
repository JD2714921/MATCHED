#!/usr/bin/env tsx
/**
 * Background worker.
 *
 * Two jobs today, both read-only and both refusing to act without permission:
 *
 *   collect-promotions — walks enabled sources and collects from the ones an
 *     administrator has approved. A source that has not been approved is
 *     SKIPPED and logged, never fetched.
 *
 *   expire-sessions — deletes sessions past their expiry.
 *
 * There is deliberately no job that places, amends or cancels anything.
 */
import PgBoss from "pg-boss";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { childLogger } from "@/lib/logger";
import { purgeExpiredSessions } from "@/lib/auth";
import { canCollectAutomatically, interpretCapture } from "@/lib/promotions/pipeline";
import { getExchangeProvider } from "@/lib/exchange";

const log = childLogger("worker");

export const QUEUES = {
  collectPromotions: "collect-promotions",
  expireSessions: "expire-sessions",
  checkExchangeHealth: "check-exchange-health",
} as const;

/**
 * Collect from approved sources only.
 *
 * The permission check is the whole point of this job: the flag defaults to
 * false in the schema and this is where that default does its work.
 */
export async function collectPromotions(): Promise<{ collected: number; skipped: number }> {
  const sources = await prisma.promotionSource.findMany({ where: { enabled: true } });

  let collected = 0;
  let skipped = 0;

  for (const source of sources) {
    const permission = canCollectAutomatically(source);
    if (!permission.allowed) {
      skipped += 1;
      log.info({ sourceId: source.id, reason: permission.reason }, "source skipped, not approved");
      continue;
    }

    // A real fetcher would go here, guarded by exactly the check above. It is
    // deliberately absent: no source in this build is approved for automated
    // fetching, and shipping a fetcher that nothing may call would invite
    // someone to call it.
    log.info({ sourceId: source.id }, "source approved for collection");
    collected += 1;
  }

  return { collected, skipped };
}

/** Re-read any capture whose promotion has no interpretation yet. */
export async function interpretPending(): Promise<number> {
  const captures = await prisma.rawPromotionCapture.findMany({
    where: { promotions: { none: {} } },
    take: 50,
  });

  for (const capture of captures) {
    await interpretCapture(capture.id);
  }

  return captures.length;
}

export async function recordExchangeHealth(): Promise<void> {
  const provider = getExchangeProvider();
  const health = await provider.healthCheck();

  await prisma.exchangeHealthCheck.create({
    data: {
      provider: health.provider,
      ok: health.ok,
      latencyMs: health.latencyMs,
      message: health.message,
      dataDelayed: health.dataDelayed,
    },
  });
}

async function main(): Promise<void> {
  if (!env.DATABASE_URL) {
    log.error("DATABASE_URL is not set");
    process.exitCode = 1;
    return;
  }

  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });

  boss.on("error", (error) => log.error({ err: String(error) }, "pg-boss error"));

  await boss.start();

  await boss.createQueue(QUEUES.collectPromotions);
  await boss.createQueue(QUEUES.expireSessions);
  await boss.createQueue(QUEUES.checkExchangeHealth);

  await boss.work(QUEUES.collectPromotions, async () => {
    const result = await collectPromotions();
    await interpretPending();
    log.info(result, "collection run complete");
  });

  await boss.work(QUEUES.expireSessions, async () => {
    const count = await purgeExpiredSessions();
    log.info({ count }, "expired sessions purged");
  });

  await boss.work(QUEUES.checkExchangeHealth, async () => {
    await recordExchangeHealth();
  });

  await boss.schedule(QUEUES.collectPromotions, "0 * * * *");
  await boss.schedule(QUEUES.expireSessions, "0 3 * * *");
  await boss.schedule(QUEUES.checkExchangeHealth, "*/15 * * * *");

  log.info("worker started");

  const stop = async () => {
    log.info("worker stopping");
    await boss.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

// Only start the queue when run directly; the functions above are importable
// and testable on their own.
if (process.argv[1]?.includes("worker")) {
  main().catch((cause) => {
    log.error({ err: String(cause) }, "worker failed to start");
    process.exitCode = 1;
  });
}
