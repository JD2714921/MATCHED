import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../password";
import {
  generateSessionToken,
  hashSessionToken,
  sessionCookieOptions,
  sessionExpiry,
} from "../session";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", encoded)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("Correct horse battery staple", encoded)).toBe(false);
    expect(await verifyPassword("", encoded)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("records its parameters in the encoded form so they can be changed later", async () => {
    const encoded = await hashPassword("x");
    const [scheme, N, r, p] = encoded.split("$");
    expect(scheme).toBe("scrypt");
    expect(N).toBe("16384");
    expect(r).toBe("8");
    expect(p).toBe("1");
    expect(encoded.split("$")).toHaveLength(6);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    for (const bad of ["", "nonsense", "scrypt$1", "bcrypt$16384$8$1$aa$bb", "scrypt$x$y$z$aa$bb"]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });

  it("rejects an empty stored hash", async () => {
    expect(await verifyPassword("anything", "scrypt$16384$8$1$c2FsdA==$")).toBe(false);
  });

  it("handles long and unicode passwords", async () => {
    const password = "🔐 a very long pass phrase with spaces and émojis ".repeat(8);
    const encoded = await hashPassword(password);
    expect(await verifyPassword(password, encoded)).toBe(true);
    expect(await verifyPassword(password.trim(), encoded)).toBe(false);
  });
});

describe("session tokens", () => {
  it("generates unguessable, unique tokens", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateSessionToken()));
    expect(tokens.size).toBe(200);
    // 32 random bytes, base64url encoded.
    expect([...tokens][0]!.length).toBeGreaterThanOrEqual(43);
    expect([...tokens].every((t) => /^[A-Za-z0-9_-]+$/.test(t))).toBe(true);
  });

  it("stores only the hash, and the hash does not contain the token", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(hash).toBe(hashSessionToken(token));
  });

  it("gives different tokens different hashes", () => {
    expect(hashSessionToken(generateSessionToken())).not.toBe(
      hashSessionToken(generateSessionToken()),
    );
  });

  it("expires thirty days out", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(sessionExpiry(from).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("sets a cookie a script cannot read and a third-party site cannot send", () => {
    const options = sessionCookieOptions(new Date("2026-01-31T00:00:00.000Z"), true);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.secure).toBe(true);
    expect(options.path).toBe("/");
  });

  it("does not demand https outside production, so local dev works", () => {
    expect(sessionCookieOptions(new Date(), false).secure).toBe(false);
  });
});
