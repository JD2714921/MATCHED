#!/usr/bin/env tsx
/**
 * Safety lint.
 *
 * The promises this product makes are only worth what enforces them. Each rule
 * below corresponds to a claim made to a customer or a regulator, and fails the
 * build rather than relying on anyone remembering:
 *
 *   1. No bet-placement code anywhere.
 *   2. No "place bet" control in the UI.
 *   3. No schema field that could hold a third-party credential.
 *   4. No payment integration.
 *   5. The calculation engine keeps its isolation.
 *   6. The AI layer does no arithmetic.
 *
 * Verified by planting deliberate violations and watching each one fail; see
 * scripts/__tests__/lints.test.ts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

export interface Violation {
  rule: string;
  file: string;
  line: number;
  excerpt: string;
  why: string;
}

const SCANNED_DIRS = ["app", "components", "lib", "worker", "prisma", "scripts", "e2e"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "test-results", "playwright-report"]);

/**
 * Files exempt from a given rule, with the reason.
 *
 * Every exemption is named individually. There is no wildcard, so adding one is
 * a visible decision in a diff.
 */
const EXEMPTIONS: Record<string, Set<string>> = {
  // These files exist to REFUSE bet placement, so they must name the things
  // they refuse.
  "no-bet-placement": new Set([
    "lib/exchange/betfair/operations.ts",
    "lib/exchange/provider.ts",
    "lib/exchange/__tests__/betfair.test.ts",
    // Names the operations in order to assert that each one is refused.
    "scripts/verify-betfair.ts",
    "scripts/lint-safety.ts",
    "scripts/__tests__/lints.test.ts",
  ]),
  "no-place-bet-control": new Set(["scripts/lint-safety.ts", "scripts/__tests__/lints.test.ts"]),
  "no-payment-integration": new Set(["scripts/lint-safety.ts", "scripts/__tests__/lints.test.ts"]),
  "no-ai-arithmetic": new Set([
    // The guard's whole job is to catch arithmetic, so it must describe it.
    "lib/ai/guard.ts",
    "lib/ai/__tests__/guard.test.ts",
    "lib/ai/prompts.ts",
    "scripts/lint-safety.ts",
    "scripts/__tests__/lints.test.ts",
  ]),
};

function isExempt(rule: string, file: string): boolean {
  return EXEMPTIONS[rule]?.has(file) ?? false;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx|prisma)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function sourceFiles(): string[] {
  return SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)));
}

interface Rule {
  name: string;
  why: string;
  /** Applied per line. */
  pattern: RegExp;
  /** Restrict to files matching this, if given. */
  appliesTo?: RegExp;
}

const RULES: Rule[] = [
  // --- 1. No bet-placement code ------------------------------------------
  {
    name: "no-bet-placement",
    why: "MATCHED never places, changes or cancels a bet. The customer does, in their own account.",
    pattern:
      /\b(placeOrders?|cancelOrders?|replaceOrders?|updateOrders?|submitBet|placeBet|placeWager|executeBet|sendBet)\b/,
  },
  // --- 2. No "place bet" control in the UI --------------------------------
  {
    name: "no-place-bet-control",
    why: "A control that looks like it places a bet would misrepresent what this product does.",
    // Anchored at both ends so it matches a COMPLETE control label — ">Place
    // bet<" or "Place bet" — and not instructional prose that happens to
    // contain the words, such as "Place the back bet first, then the lay."
    pattern:
      /(?:>|["'`])\s*(?:Place (?:the |your )?(?:bet|lay|back|wager)s?|Bet now|Place now|Submit (?:the )?bet|Confirm (?:the )?bet|Lay it now|Back it now)\s*[.!]?\s*(?:<|["'`])/i,
    appliesTo: /\.(tsx|ts)$/,
  },
  // --- 3. No third-party credential storable ------------------------------
  {
    name: "no-third-party-credentials",
    why: "The schema must not be able to hold a way into a customer's bookmaker or exchange account.",
    // Checked with bespoke logic below.
    pattern: /$^/,
  },
  // --- 4. No payment integration ------------------------------------------
  {
    name: "no-payment-integration",
    why: "MATCHED holds no funds. A payment integration would make that untrue.",
    pattern:
      /\b(stripe|braintree|adyen|worldpay|paypal|@stripe\/|createPaymentIntent|chargeCard|cardNumber|cvv|iban|sortCode)\b/i,
  },
  // --- 6. No arithmetic in the AI layer ------------------------------------
  {
    name: "no-ai-arithmetic",
    why: "Every figure comes from lib/math. The AI layer reads text and writes prose; it never computes money.",
    pattern:
      /\b(?:new\s+Decimal|Decimal\.|calculateHedge|idealLayStake|planTokens|bankrollRequirement|roundStake)\b/,
    appliesTo: /^lib\/ai\//,
  },
];

/**
 * Does this field name look like it could hold a credential for somebody
 * else's service?
 *
 * Must be camelCase-aware: a plain word-boundary test does NOT match
 * "password" inside "bookmakerPassword", which is precisely the name such a
 * field would be given.
 *
 * `username` and `login` count — an operator username is half of a credential,
 * and exactly the sort of field that grows a password beside it later.
 */
const LONG_CREDENTIAL_WORDS = [
  "password",
  "passwd",
  "passphrase",
  "secret",
  "credential",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "authtoken",
  "bearertoken",
  "privatekey",
  "clientsecret",
  "username",
  "login",
  "cookie",
];

/**
 * Short words are checked as whole camelCase words only, so "pin" does not
 * fire on "spinner" and "key" does not fire on "monkey".
 *
 * "token" is deliberately NOT here: in this domain a token is a free bet, and
 * `rewardTokenValue` is a money field, not a credential. The compound forms
 * that WOULD be credentials (accessToken, refreshToken, …) are listed above.
 */
const SHORT_CREDENTIAL_WORDS = new Set(["pin", "otp", "mfa", "key", "auth"]);

function splitCamelCase(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function looksLikeCredentialField(name: string): boolean {
  const words = splitCamelCase(name);
  if (words.some((word) => SHORT_CREDENTIAL_WORDS.has(word))) return true;
  const joined = words.join("");
  return LONG_CREDENTIAL_WORDS.some((word) => joined.includes(word));
}

/**
 * The only credentials in the system are OUR OWN: the customer's password for
 * this service, and the hash of their session token for this service. Both are
 * named here explicitly.
 */
const ALLOWED_SCHEMA_FIELDS = new Set([
  "User.passwordHash",
  "UserSession.tokenHash",
]);

function checkSchema(): Violation[] {
  const schemaPath = join(ROOT, "prisma", "schema.prisma");
  let source: string;
  try {
    source = readFileSync(schemaPath, "utf8");
  } catch {
    return [];
  }

  const violations: Violation[] = [];
  const lines = source.split("\n");
  let model: string | null = null;

  lines.forEach((line, index) => {
    const modelMatch = /^\s*model\s+(\w+)\s*\{/.exec(line);
    if (modelMatch) {
      model = modelMatch[1]!;
      return;
    }
    if (/^\s*\}/.test(line)) {
      model = null;
      return;
    }
    if (!model) return;

    // Field declarations only: "  name  Type  ...". Skip comments and blocks.
    const fieldMatch = /^\s{2,}(\w+)\s+\w/.exec(line);
    if (!fieldMatch) return;
    if (/^\s*(\/\/|\/\/\/|@@)/.test(line)) return;

    const field = fieldMatch[1]!;
    if (!looksLikeCredentialField(field)) return;

    const qualified = `${model}.${field}`;
    if (ALLOWED_SCHEMA_FIELDS.has(qualified)) return;

    violations.push({
      rule: "no-third-party-credentials",
      file: "prisma/schema.prisma",
      line: index + 1,
      excerpt: line.trim(),
      why: `"${qualified}" could hold a credential for a third party. MATCHED never accesses a customer's operator accounts, so no such field may exist. The only permitted credentials are ${[...ALLOWED_SCHEMA_FIELDS].join(" and ")}.`,
    });
  });

  return violations;
}

/**
 * Rule 5: the calculation engine keeps its isolation.
 *
 * A second, independent check of what lib/math/__tests__/purity.test.ts
 * asserts, so the guarantee survives someone deleting the test.
 */
function checkEngineIsolation(): Violation[] {
  const violations: Violation[] = [];
  const engineDir = join(ROOT, "lib", "math");

  for (const file of walk(engineDir)) {
    const relativePath = relative(ROOT, file);
    if (relativePath.includes("__tests__")) continue;

    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const match = /\bfrom\s*["']([^"']+)["']/.exec(line);
      const specifier = match?.[1];
      if (!specifier) return;
      if (specifier === "decimal.js") return;

      // A relative import is not automatically fine: "../db" is relative and
      // reaches straight out of the engine. Resolve it and check where it
      // actually lands.
      if (specifier.startsWith(".")) {
        const target = resolve(join(file, ".."), specifier);
        if (target.startsWith(engineDir)) return;
        violations.push({
          rule: "engine-isolation",
          file: relativePath,
          line: index + 1,
          excerpt: line.trim(),
          why: `"${specifier}" resolves outside lib/math. The calculation engine may import decimal.js and its own files only; that isolation is what makes every figure traceable.`,
        });
        return;
      }

      violations.push({
        rule: "engine-isolation",
        file: relativePath,
        line: index + 1,
        excerpt: line.trim(),
        why: `The calculation engine may import decimal.js and its own files only. "${specifier}" breaks the isolation that makes every figure traceable.`,
      });
    });
  }

  return violations;
}

export function runSafetyLint(): Violation[] {
  const violations: Violation[] = [...checkSchema(), ...checkEngineIsolation()];

  for (const file of sourceFiles()) {
    const relativePath = relative(ROOT, file);
    const lines = readFileSync(file, "utf8").split("\n");

    for (const rule of RULES) {
      if (rule.pattern.source === "$^") continue;
      if (rule.appliesTo && !rule.appliesTo.test(relativePath)) continue;
      if (isExempt(rule.name, relativePath)) continue;

      lines.forEach((line, index) => {
        // A line that is only a comment is documentation, not behaviour.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (!rule.pattern.test(line)) return;

        violations.push({
          rule: rule.name,
          file: relativePath,
          line: index + 1,
          excerpt: line.trim().slice(0, 160),
          why: rule.why,
        });
      });
    }
  }

  return violations;
}

function main(): void {
  const violations = runSafetyLint();

  if (violations.length === 0) {
    console.log("safety lint: clean");
    console.log("  no bet placement, no place-bet control, no third-party credential field,");
    console.log("  no payment integration, engine isolated, no arithmetic in the AI layer.");
    return;
  }

  console.error(`safety lint: ${violations.length} violation(s)\n`);
  for (const violation of violations) {
    console.error(`  [${violation.rule}] ${violation.file}:${violation.line}`);
    console.error(`    ${violation.excerpt}`);
    console.error(`    ${violation.why}\n`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  main();
}
