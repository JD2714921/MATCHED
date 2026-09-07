import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSafetyLint, looksLikeCredentialField } from "../lint-safety";
import { runCopyLint } from "../lint-copy";

/**
 * A check nobody has seen fail is not a check.
 *
 * These tests plant deliberate violations in the real tree, run the real lint,
 * and assert that it catches them — then remove them. Without this, both lints
 * could be silently broken (a bad regex, a wrong path root) and would report
 * "clean" forever.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const planted: string[] = [];

/** Write a file into the real source tree so the lint's own walker finds it. */
function plant(relativePath: string, contents: string): void {
  const full = join(ROOT, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, contents, "utf8");
  planted.push(full);
}

afterEach(() => {
  while (planted.length > 0) {
    rmSync(planted.pop()!, { force: true });
  }
});

describe("the tree is clean as it stands", () => {
  it("passes the safety lint", () => {
    const violations = runSafetyLint();
    expect(
      violations,
      violations.map((v) => `${v.rule} ${v.file}:${v.line}`).join("\n"),
    ).toEqual([]);
  });

  it("passes the copy lint", () => {
    const { violations } = runCopyLint();
    expect(
      violations,
      violations.map((v) => `${v.rule} ${v.file}:${v.line}`).join("\n"),
    ).toEqual([]);
  });

  it("records every copy suppression with a stated reason", () => {
    const { suppressions } = runCopyLint();
    for (const suppression of suppressions) {
      expect(suppression.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("the safety lint catches planted violations", () => {
  it("catches bet-placement code", () => {
    plant(
      "lib/planted-violation.ts",
      `export async function go() {\n  return placeOrders({ marketId: "1.1" });\n}\n`,
    );
    const violations = runSafetyLint();
    expect(violations.some((v) => v.rule === "no-bet-placement")).toBe(true);
  });

  it("catches an unfamiliar bet-placement name too", () => {
    plant("lib/planted-violation.ts", `export const submit = () => submitBet({});\n`);
    expect(runSafetyLint().some((v) => v.rule === "no-bet-placement")).toBe(true);
  });

  it("catches a place-bet control in the UI", () => {
    plant(
      "components/planted-violation.tsx",
      `export function Bad() {\n  return <button>Place bet</button>;\n}\n`,
    );
    const violations = runSafetyLint();
    expect(violations.some((v) => v.rule === "no-place-bet-control")).toBe(true);
  });

  it("does not mistake instructional prose for a control", () => {
    plant(
      "components/planted-violation.tsx",
      `export function Fine() {\n  return <p>Place the back bet first, then the lay.</p>;\n}\n`,
    );
    const violations = runSafetyLint();
    expect(violations.some((v) => v.rule === "no-place-bet-control")).toBe(false);
  });

  it("catches a payment integration", () => {
    plant(
      "lib/planted-violation.ts",
      `export const pay = () => createPaymentIntent({ amount: 100 });\n`,
    );
    expect(runSafetyLint().some((v) => v.rule === "no-payment-integration")).toBe(true);
  });

  it("catches arithmetic in the AI layer", () => {
    plant(
      "lib/ai/planted-violation.ts",
      `import Decimal from "decimal.js";\nexport const v = new Decimal(10).times(3);\n`,
    );
    expect(runSafetyLint().some((v) => v.rule === "no-ai-arithmetic")).toBe(true);
  });

  it("catches the engine losing its isolation", () => {
    plant(
      "lib/math/planted-violation.ts",
      `import { prisma } from "../db";\nexport const p = prisma;\n`,
    );
    const violations = runSafetyLint();
    expect(violations.some((v) => v.rule === "engine-isolation")).toBe(true);
  });

  it("catches a schema field that could hold a third-party credential", () => {
    // The real schema is edited and restored, because the credential rule
    // reads prisma/schema.prisma specifically.
    const schemaPath = join(ROOT, "prisma", "schema.prisma");
    const original = readFileSync(schemaPath, "utf8");
    const anchor = "  status   AccountStatus @default(NOT_OPENED)";
    try {
      // Guard the plant itself: if the anchor ever moves, this test must fail
      // loudly rather than quietly asserting against an unmodified schema.
      expect(original).toContain(anchor);
      writeFileSync(
        schemaPath,
        original.replace(anchor, `${anchor}\n  bookmakerPassword String?`),
        "utf8",
      );
      const violations = runSafetyLint();
      const credential = violations.filter((v) => v.rule === "no-third-party-credentials");
      expect(credential).toHaveLength(1);
      expect(credential[0]!.excerpt).toContain("bookmakerPassword");
      expect(credential[0]!.why).toContain("UserOperatorAccount.bookmakerPassword");
    } finally {
      writeFileSync(schemaPath, original, "utf8");
    }
  });

  it("recognises credential field names however they are cased", () => {
    for (const name of [
      "password",
      "bookmakerPassword",
      "operator_password",
      "exchangeApiKey",
      "accessToken",
      "refreshToken",
      "operatorUsername",
      "loginCookie",
      "accountPin",
      "totpSecret",
    ]) {
      expect(looksLikeCredentialField(name), `${name} should be flagged`).toBe(true);
    }
  });

  it("does not mistake a free-bet token for a credential", () => {
    // In this domain a "token" is a free bet, and these are money fields.
    for (const name of [
      "rewardTokenValue",
      "rewardTokenCount",
      "tokenExpiresAt",
      "spinner",
      "monkey",
      "marketId",
      "selectionName",
    ]) {
      expect(looksLikeCredentialField(name), `${name} should not be flagged`).toBe(false);
    }
  });

  it("still permits our own password and session-token hashes", () => {
    // These are OUR credentials for OUR service, not a third party's.
    const violations = runSafetyLint().filter((v) => v.rule === "no-third-party-credentials");
    expect(violations).toEqual([]);
  });
});

describe("the copy lint catches planted violations", () => {
  const cases: Array<[string, string]> = [
    ["no-guaranteed-profit", "This offer guarantees a profit of ten pounds."],
    ["no-guaranteed-profit-noun", "A guaranteed profit every single time."],
    ["no-risk-free", "A completely risk-free way to bet."],
    ["no-risk-free", "This is risk free, we promise."],
    ["no-no-risk", "Place it without any risk at all."],
    ["no-cant-lose", "You literally cannot lose on this one."],
    ["no-income-claims", "Make £500 a month from matched betting."],
    ["no-income-claims-generic", "Build a second income from your sofa."],
    ["no-restriction-evasion", "Place mug bets to disguise your activity."],
    ["no-multi-accounting", "Open a second account to claim it twice."],
    ["no-arbitrage-promises", "It is basically free money."],
  ];

  for (const [rule, copy] of cases) {
    it(`catches ${rule}: "${copy}"`, () => {
      plant("components/planted-copy.tsx", `export const Bad = () => <p>${copy}</p>;\n`);
      const { violations } = runCopyLint();
      expect(
        violations.some((v) => v.rule === rule),
        `expected ${rule} to fire on "${copy}", got: ${violations.map((v) => v.rule).join(", ") || "nothing"}`,
      ).toBe(true);
    });
  }

  it("catches banned copy in markdown as well as code", () => {
    plant("docs/planted-copy.md", "# Guide\n\nThis is a risk-free strategy.\n");
    const { violations } = runCopyLint();
    expect(violations.some((v) => v.rule === "no-risk-free")).toBe(true);
  });

  it("names what to write instead", () => {
    plant("components/planted-copy.tsx", `export const Bad = () => <p>risk-free returns</p>;\n`);
    const { violations } = runCopyLint();
    const violation = violations.find((v) => v.rule === "no-risk-free");
    expect(violation?.instead).toContain("outcome-neutral matched position");
  });

  it("honours an inline suppression that states a reason", () => {
    plant(
      "components/planted-copy.tsx",
      `// lint-copy-allow: quoting the phrase in order to warn against it\nexport const Fine = () => <p>never say risk-free</p>;\n`,
    );
    const { violations, suppressions } = runCopyLint();
    expect(violations.some((v) => v.file === "components/planted-copy.tsx")).toBe(false);
    expect(suppressions.some((s) => s.file === "components/planted-copy.tsx")).toBe(true);
  });

  it("ignores a suppression marker with no reason given", () => {
    plant(
      "components/planted-copy.tsx",
      `// lint-copy-allow:\nexport const Bad = () => <p>a risk-free strategy</p>;\n`,
    );
    const { violations } = runCopyLint();
    expect(violations.some((v) => v.rule === "no-risk-free")).toBe(true);
  });

  it("accepts the approved vocabulary", () => {
    plant(
      "components/planted-copy.tsx",
      `export const Good = () => (\n  <p>\n    A calculated locked return on an outcome-neutral matched position. The\n    qualifying loss is shown, and the calculated return across outcomes is a\n    matched-betting opportunity, not a promise.\n  </p>\n);\n`,
    );
    const { violations } = runCopyLint();
    expect(violations.filter((v) => v.file === "components/planted-copy.tsx")).toEqual([]);
  });
});
