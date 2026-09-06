import { prisma, Prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import {
  collectCapture,
  contentHash,
  interpretCapture,
  publishPromotion,
} from "@/lib/promotions/pipeline";
import { DEMO_USERS, SEED_OPERATORS } from "./seed-data";

/**
 * Seed the development database.
 *
 * Two things this deliberately does NOT do:
 *
 *  1. It does not write interpreted promotion fields directly. Every seeded
 *     promotion goes through the real collection and interpretation pipeline,
 *     so its confidence figures and unread fields are genuine — the admin
 *     queue shows real output, not a mock of it.
 *
 *  2. It does not use `prisma migrate reset`, which requires interactive
 *     consent and refuses in a non-interactive shell. Rows are deleted
 *     directly instead.
 */

async function clear(): Promise<void> {
  // Order matters: children first, because not every relation cascades.
  await prisma.auditLog.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.betLeg.deleteMany();
  await prisma.marketPriceQuote.deleteMany();
  await prisma.betPlan.deleteMany();
  await prisma.promotionInterpretation.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.rawPromotionCapture.deleteMany();
  await prisma.promotionSource.deleteMany();
  await prisma.bankrollAccount.deleteMany();
  await prisma.userOperatorAccount.deleteMany();
  await prisma.operator.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.user.deleteMany();
  await prisma.exchangeHealthCheck.deleteMany();
}

async function main(): Promise<void> {
  console.log("Clearing existing rows…");
  await clear();

  console.log("Creating users…");
  const customer = await prisma.user.create({
    data: {
      email: DEMO_USERS.customer.email,
      displayName: DEMO_USERS.customer.displayName,
      passwordHash: await hashPassword(DEMO_USERS.customer.password),
      role: "CUSTOMER",
    },
  });
  const admin = await prisma.user.create({
    data: {
      email: DEMO_USERS.admin.email,
      displayName: DEMO_USERS.admin.displayName,
      passwordHash: await hashPassword(DEMO_USERS.admin.password),
      role: "ADMIN",
    },
  });

  console.log("Creating operators, sources and captures…");
  let published = 0;
  let needsVerification = 0;

  for (const seedOperator of SEED_OPERATORS) {
    const operator = await prisma.operator.create({
      data: {
        name: seedOperator.name,
        slug: seedOperator.slug,
        websiteUrl: seedOperator.websiteUrl,
        notes: seedOperator.notes,
        isFictional: true,
      },
    });

    for (const seedSource of seedOperator.sources) {
      const approved = seedSource.approved ?? false;
      const source = await prisma.promotionSource.create({
        data: {
          operatorId: operator.id,
          name: seedSource.name,
          collectionMethod: seedSource.collectionMethod,
          url: seedSource.url ?? null,
          automatedCollectionApproved: approved,
          ...(approved
            ? {
                robotsTxtCheckedAt: new Date(),
                robotsTxtCheckedBy: admin.id,
                robotsTxtAllows: true,
                termsReviewedAt: new Date(),
                termsReviewedBy: admin.id,
                approvalNote:
                  "Supplied by the operator under an affiliate agreement; nothing is fetched from their site.",
              }
            : {}),
        },
      });

      for (const seedCapture of seedSource.captures) {
        // For an unapproved automated source the pipeline would refuse to
        // collect, which is the point of the flag. The seed writes the capture
        // directly to represent one entered by hand by a member of staff,
        // rather than pretending the fetch was allowed.
        const capture =
          seedSource.collectionMethod === "PUBLIC_PAGE_FETCH" && !approved
            ? await prisma.rawPromotionCapture.create({
                data: {
                  sourceId: source.id,
                  rawTitle: seedCapture.title,
                  rawText: seedCapture.rawText,
                  contentHash: contentHash(seedCapture.title, seedCapture.rawText),
                  sourceUrl: seedSource.url ?? null,
                },
              })
            : await collectCapture({
                sourceId: source.id,
                title: seedCapture.title,
                rawText: seedCapture.rawText,
                ...(seedSource.url ? { sourceUrl: seedSource.url } : {}),
              });

        // The real pipeline, so confidence and unread fields are genuine.
        const outcome = await interpretCapture(capture.id);

        console.log(
          `  ${seedOperator.name}: "${seedCapture.title}" — confidence ${(outcome.confidence * 100).toFixed(1)}%, ` +
            `${outcome.issues.filter((i) => i.severity === "BLOCKING").length} blocking issue(s)`,
        );

        if (seedCapture.publish && outcome.reviewReady) {
          // An administrator reviewed and published it. Only a person can.
          await publishPromotion(outcome.promotionId, admin.id);
          published += 1;
        } else {
          needsVerification += 1;
        }
      }
    }

    await prisma.userOperatorAccount.create({
      data: {
        userId: customer.id,
        operatorId: operator.id,
        status: seedOperator.slug === "northgate-bet" ? "OPEN" : "NOT_OPENED",
        ...(seedOperator.slug === "northgate-bet" ? { openedAt: new Date() } : {}),
      },
    });
  }

  console.log("Creating bankroll accounts…");
  await prisma.bankrollAccount.createMany({
    data: [
      {
        userId: customer.id,
        kind: "EXCHANGE",
        label: "Exchange balance",
        balance: new Prisma.Decimal("500.00"),
      },
      {
        userId: customer.id,
        kind: "BOOKMAKER",
        label: "Across bookmakers",
        balance: new Prisma.Decimal("250.00"),
      },
    ],
  });

  console.log();
  console.log(`Done. ${published} published, ${needsVerification} awaiting verification.`);
  console.log();
  console.log(`  Customer: ${DEMO_USERS.customer.email} / ${DEMO_USERS.customer.password}`);
  console.log(`  Admin:    ${DEMO_USERS.admin.email} / ${DEMO_USERS.admin.password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
