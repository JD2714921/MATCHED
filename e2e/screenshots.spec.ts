import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Screenshots for visual review.
 *
 * These are not assertions about pixels. They exist because a passing test
 * suite says nothing about whether a column has been crushed to six wrapped
 * lines or a badge is sitting on top of its neighbour — defects that are
 * obvious the moment a person looks at the page and invisible until then.
 */

const PAGES: Array<{ path: string; name: string; admin?: boolean }> = [
  { path: "/", name: "today" },
  { path: "/offers", name: "offers" },
  { path: "/match", name: "match-finder" },
  { path: "/bets", name: "my-bets" },
  { path: "/bankroll", name: "bankroll" },
  { path: "/profit", name: "profit" },
  { path: "/learn", name: "learn" },
  { path: "/admin", name: "admin-queue", admin: true },
  { path: "/admin/sources", name: "admin-sources", admin: true },
  { path: "/admin/audit", name: "admin-audit", admin: true },
];

for (const page of PAGES) {
  test(`screenshot: ${page.name}`, async ({ page: browserPage }) => {
    await signIn(browserPage, page.admin ? "admin" : "customer");
    await browserPage.goto(page.path);
    await browserPage.waitForLoadState("networkidle");

    // No page may scroll horizontally: a table that overflows its container
    // must scroll inside its own box, not push the whole layout sideways.
    const overflow = await browserPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${page.name} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(1);

    await browserPage.screenshot({
      path: `e2e/screenshots/${page.name}.png`,
      fullPage: true,
    });
  });
}
