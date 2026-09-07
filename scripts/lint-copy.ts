#!/usr/bin/env tsx
/**
 * Copy lint.
 *
 * Matched betting is a regulated-adjacent subject in the UK, and the way it is
 * described is not a matter of taste. CAP and BCAP rules on gambling
 * advertising, and consumer-protection law generally, make a claim of
 * guaranteed profit or risk-free returns both wrong and actionable. Every
 * calculation in this product depends on both bets being placed as described
 * and both settling normally; none of that is guaranteed.
 *
 * This lint fails the build on the language that would make those claims, and
 * on income claims and anything shading into evading operator restrictions.
 *
 * Verified by planting deliberate violations; see scripts/__tests__/lints.test.ts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

export interface CopyViolation {
  rule: string;
  file: string;
  line: number;
  excerpt: string;
  why: string;
  instead: string;
}

const SCANNED_DIRS = ["app", "components", "lib", "prisma", "docs", "e2e", "worker"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "test-results", "playwright-report"]);

/** The vocabulary that is accurate, and that these rules push you towards. */
export const APPROVED_VOCABULARY = [
  "calculated locked return",
  "outcome-neutral matched position",
  "calculated return across outcomes",
  "matched-betting opportunity",
  "qualifying loss",
];

const EXEMPT_FILES = new Set([
  "scripts/lint-copy.ts",
  "scripts/__tests__/lints.test.ts",
  // The legal review inventories the language that must not be used, so it has
  // to be able to name it.
  "docs/legal-review.md",
]);

interface CopyRule {
  name: string;
  pattern: RegExp;
  why: string;
  instead: string;
}

const RULES: CopyRule[] = [
  {
    name: "no-guaranteed-profit",
    pattern: /\bguarantee(?:d|s|ing)?\s+(?:a\s+)?(?:profit|return|win|income|money|payout)\b/i,
    why: "Nothing here is guaranteed. Bets are voided, markets are suspended, terms are applied differently than they read, and accounts are restricted.",
    instead: "calculated locked return, or calculated return across outcomes",
  },
  {
    name: "no-guaranteed-profit-noun",
    pattern: /\b(?:guaranteed|assured|certain|sure)\s+(?:profit|money|winnings|income)\b/i,
    why: "A guarantee cannot be made about the outcome of a bet placed by someone else at a third party.",
    instead: "calculated locked return",
  },
  {
    name: "no-risk-free",
    pattern: /\brisk[\s-]?free\b/i,
    why: "Not risk-free: execution risk, price movement, partial fills, voided events and operator discretion all remain with the customer.",
    instead: "outcome-neutral matched position",
  },
  {
    name: "no-no-risk",
    pattern: /\bno[\s-]risk\b|\bwithout\s+(?:any\s+)?risk\b|\bzero\s+risk\b/i,
    why: "Risk is reduced by hedging, not removed.",
    instead: "outcome-neutral matched position",
  },
  {
    name: "no-cant-lose",
    pattern: /\b(?:can(?:no|')t\s+lose|cannot\s+lose|never\s+lose|always\s+win)\b/i,
    why: "A claim that a customer cannot lose is false and would be a misleading commercial practice.",
    instead: "calculated return across outcomes",
  },
  {
    name: "no-income-claims",
    pattern:
      /\b(?:make|earn|profit)\s+(?:£|\$)\s?[\d,]+(?:\.\d+)?\s*(?:\+|plus)?\s*(?:a|per|every|each)\s+(?:day|week|month|year)\b/i,
    why: "An income claim promises earnings that depend entirely on offer availability, the customer's own accounts and their execution.",
    instead: "state the calculated return of a specific opportunity instead",
  },
  {
    name: "no-income-claims-generic",
    pattern:
      /\b(?:second income|replace your (?:salary|income|job)|quit your job|financial freedom|get rich|easy money|free money)\b/i,
    why: "Income framing of this kind is both unevidenced and, for a gambling-adjacent product, an advertising problem.",
    instead: "describe what the tool calculates, not what someone might earn",
  },
  {
    name: "no-restriction-evasion",
    pattern:
      /\b(?:avoid(?:ing)?\s+(?:detection|being\s+(?:caught|limited|gubbed))|evade|evading|stay\s+under\s+the\s+radar|fly\s+under\s+the\s+radar|beat\s+the\s+bookie'?s?\s+(?:systems?|detection)|mug\s+bet(?:ting|s)?\s+to\s+(?:hide|disguise|avoid))\b/i,
    why: "Advising customers how to evade an operator's own risk controls is not a business this product is in.",
    instead: "nothing — this product does not advise on operator restrictions",
  },
  {
    name: "no-multi-accounting",
    pattern:
      /\b(?:multi[\s-]?account(?:ing|s)?|second account|gnoming|multiple accounts (?:with|at) (?:the same|one) (?:bookmaker|operator)|open (?:an )?account (?:in|under) (?:someone|another person)'?s? name)\b/i,
    why: "Multi-accounting breaches operators' terms and can constitute fraud. It must not be described as a technique here.",
    instead: "nothing — this product does not advise on multi-accounting",
  },
  {
    name: "no-arbitrage-promises",
    pattern: /\b(?:free\s+money|money\s+for\s+nothing|printing\s+money|beat\s+the\s+bookies)\b/i,
    why: "Framing of this kind overstates the certainty of the result and understates the work and risk involved.",
    instead: "matched-betting opportunity",
  },
];

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
    } else if (/\.(ts|tsx|md|prisma)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * An inline suppression, which must state its reason:
 *
 *   // lint-copy-allow: naming the banned phrases in order to forbid them
 *
 * Preferred over exempting a whole file, because it is scoped to one line, it
 * is visible in the diff that introduces it, and every use is listed in this
 * lint's own output so suppressions cannot quietly accumulate.
 */
const ALLOW_DIRECTIVE = /lint-copy-allow:\s*(\S.*)$/;

export interface Suppression {
  file: string;
  line: number;
  reason: string;
}

export function runCopyLint(): { violations: CopyViolation[]; suppressions: Suppression[] } {
  const violations: CopyViolation[] = [];
  const suppressions: Suppression[] = [];
  const files = SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)));

  for (const file of files) {
    const relativePath = relative(ROOT, file);
    if (EXEMPT_FILES.has(relativePath)) continue;

    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      // A directive on the line itself, or on the line directly above it.
      const directive =
        ALLOW_DIRECTIVE.exec(line) ?? ALLOW_DIRECTIVE.exec(lines[index - 1] ?? "");

      for (const rule of RULES) {
        if (!rule.pattern.test(line)) continue;

        if (directive?.[1]) {
          suppressions.push({
            file: relativePath,
            line: index + 1,
            reason: directive[1].trim(),
          });
          return;
        }

        violations.push({
          rule: rule.name,
          file: relativePath,
          line: index + 1,
          excerpt: line.trim().slice(0, 160),
          why: rule.why,
          instead: rule.instead,
        });
      }
    });
  }

  return { violations, suppressions };
}

function main(): void {
  const { violations, suppressions } = runCopyLint();

  if (violations.length === 0) {
    console.log("copy lint: clean");
    console.log(`  approved vocabulary: ${APPROVED_VOCABULARY.join("; ")}`);
    if (suppressions.length > 0) {
      console.log(`\n  ${suppressions.length} suppression(s), each with a stated reason:`);
      for (const suppression of suppressions) {
        console.log(`    ${suppression.file}:${suppression.line} — ${suppression.reason}`);
      }
    }
    return;
  }

  console.error(`copy lint: ${violations.length} violation(s)\n`);
  for (const violation of violations) {
    console.error(`  [${violation.rule}] ${violation.file}:${violation.line}`);
    console.error(`    ${violation.excerpt}`);
    console.error(`    ${violation.why}`);
    console.error(`    Instead: ${violation.instead}\n`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  main();
}
