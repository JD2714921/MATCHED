import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "matched_session";
export const SESSION_TTL_DAYS = 30;

/**
 * Opaque session tokens.
 *
 * The token is random and carries no claims — nothing about it can be forged
 * or replayed, and revoking it is a row delete. Only its SHA-256 is stored, so
 * reading the database does not hand anyone a working login.
 *
 * A JWT would have put the same guarantees behind a signing key we would then
 * have to rotate and protect; this is smaller and harder to get wrong.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function sessionCookieOptions(expiresAt: Date, secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    expires: expiresAt,
  };
}
