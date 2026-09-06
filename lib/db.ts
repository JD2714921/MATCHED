import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton.
 *
 * Next's dev server re-evaluates modules on every edit, which would otherwise
 * open a new connection pool each time until Postgres refuses more.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export { Prisma } from "@prisma/client";
