import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";

/**
 * The engine's isolation rule, enforced.
 *
 * lib/math may import decimal.js and its own files, and nothing else. No
 * database, no network, no logger, no framework, no environment access. That
 * restriction is what lets us say a figure shown to a customer is a pure
 * function of stated inputs — and it only stays true if something checks.
 *
 * Deliberately implemented by walking the source rather than by trusting a
 * lint config, so that it fails the build wherever the build runs.
 */

const ENGINE_ROOT = resolve(import.meta.dirname, "..");
const ALLOWED_PACKAGES = new Set(["decimal.js"]);

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Test files are not part of the engine and may import what they need.
      if (entry === "__tests__") continue;
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Every module specifier in a file: static imports, re-exports, and dynamic. */
function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bimport\s+(?:[\s\S]*?)\s*from\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bexport\s+(?:[\s\S]*?)\s*from\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) specifiers.push(match[1]);
    }
  }
  // Several of the patterns overlap on the same source text; report each
  // distinct specifier once.
  return [...new Set(specifiers)];
}

describe("calculation engine isolation", () => {
  const files = collectSourceFiles(ENGINE_ROOT);

  it("finds the engine source files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("imports nothing but decimal.js and its own files", () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of extractSpecifiers(source)) {
        const shown = `${relative(ENGINE_ROOT, file)} -> ${specifier}`;

        if (specifier.startsWith(".")) {
          const target = resolve(dirname(file), specifier);
          if (!target.startsWith(ENGINE_ROOT)) {
            violations.push(`${shown} (relative import escapes lib/math)`);
          }
          continue;
        }

        if (!ALLOWED_PACKAGES.has(specifier)) {
          violations.push(`${shown} (package not on the engine allow-list)`);
        }
      }
    }

    expect(violations, `engine isolation broken:\n${violations.join("\n")}`).toEqual([]);
  });

  it("never reaches for globals that imply I/O or ambient state", () => {
    // A pure engine has no business reading configuration or the clock: a
    // result must depend only on its arguments, or it cannot be reproduced
    // from an audit record.
    const forbidden = [
      { pattern: /\bprocess\.env\b/, why: "reads environment configuration" },
      { pattern: /\bDate\.now\s*\(/, why: "reads the clock" },
      { pattern: /\bnew\s+Date\s*\(\s*\)/, why: "reads the clock" },
      { pattern: /\bMath\.random\s*\(/, why: "is non-deterministic" },
      { pattern: /\bfetch\s*\(/, why: "performs network I/O" },
    ];

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const { pattern, why } of forbidden) {
        if (pattern.test(source)) {
          violations.push(`${relative(ENGINE_ROOT, file)} ${why}`);
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("never uses the JavaScript number type for a money calculation", () => {
    // parseFloat/Number() on a money string is exactly the bug decimal.js is
    // here to prevent.
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const bad of [/\bparseFloat\s*\(/, /\bNumber\s*\(/, /\btoFixed\s*\(\s*\)/]) {
        if (bad.test(source)) violations.push(`${relative(ENGINE_ROOT, file)} uses ${bad}`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
