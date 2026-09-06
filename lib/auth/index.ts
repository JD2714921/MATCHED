import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isProduction } from "@/lib/env";
import { hashPassword, verifyPassword } from "./password";
import {
  SESSION_COOKIE,
  generateSessionToken,
  hashSessionToken,
  sessionCookieOptions,
  sessionExpiry,
} from "./session";

export * from "./session";
export { hashPassword, verifyPassword } from "./password";

export class AuthError extends Error {
  readonly code: "INVALID_CREDENTIALS" | "EMAIL_TAKEN" | "NOT_AUTHENTICATED" | "FORBIDDEN";

  constructor(code: AuthError["code"], message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export type SafeUser = Pick<User, "id" | "email" | "displayName" | "role">;

function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

const normaliseEmail = (email: string) => email.trim().toLowerCase();

export async function registerUser(
  email: string,
  password: string,
  displayName?: string,
): Promise<SafeUser> {
  const normalised = normaliseEmail(email);
  const existing = await prisma.user.findUnique({ where: { email: normalised } });
  if (existing) throw new AuthError("EMAIL_TAKEN", "That email address is already registered.");

  const user = await prisma.user.create({
    data: {
      email: normalised,
      passwordHash: await hashPassword(password),
      displayName: displayName?.trim() || null,
    },
  });
  return toSafeUser(user);
}

export async function authenticate(email: string, password: string): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { email: normaliseEmail(email) } });

  // Hash against a dummy when the user does not exist, so a missing account
  // and a wrong password take the same time and cannot be told apart.
  if (!user) {
    await verifyPassword(password, await DUMMY_HASH);
    throw new AuthError("INVALID_CREDENTIALS", "Email or password is not correct.");
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new AuthError("INVALID_CREDENTIALS", "Email or password is not correct.");
  }

  return toSafeUser(user);
}

/** Computed once, lazily; only ever compared against, never a real password. */
const DUMMY_HASH: Promise<string> = hashPassword(generateSessionToken());

export async function createSession(userId: string, userAgent?: string): Promise<string> {
  const token = generateSessionToken();
  const expiresAt = sessionExpiry();

  await prisma.userSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 500) ?? null,
    },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt, isProduction));
  return token;
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.userSession
      .deleteMany({ where: { tokenHash: hashSessionToken(token) } })
      .catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Safe to call from any server component. */
export async function getCurrentUser(): Promise<SafeUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.userSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  // Touch at most once an hour: every page view would otherwise be a write.
  if (Date.now() - session.lastSeenAt.getTime() > 3_600_000) {
    await prisma.userSession
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  return toSafeUser(session.user);
}

export async function requireUser(): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("NOT_AUTHENTICATED", "Sign in to continue.");
  return user;
}

export async function requireAdmin(): Promise<SafeUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw new AuthError("FORBIDDEN", "This area is for administrators.");
  }
  return user;
}

export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.userSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
