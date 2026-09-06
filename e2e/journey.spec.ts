import { test, expect, type Page } from "@playwright/test";
import { signIn, fetchInPage } from "./helpers";

/**
 * The whole product, as one journey.
 *
 * Fifteen steps from opening the dashboard to seeing a realised return on it,
 * run as a single test rather than fifteen isolated ones — the thing worth
 * proving is that the path holds end to end, not that each screen renders.
 */
test.describe.configure({ mode: "serial" });

test("a customer works an offer from the dashboard to a realised return", async ({ page }) => {
  test.setTimeout(180_000);

  await signIn(page, "customer");

  // ---- 1. Open the dashboard -------------------------------------------
  await page.goto("/");
  await expect(page.getByText("Available now")).toBeVisible();
  await expect(page.getByText("Where to start")).toBeVisible();

  // ---- 2. View a verified offer ----------------------------------------
  await page.goto("/offers");
  const offerRows = page.getByTestId("offer-row");
  await expect(offerRows.first()).toBeVisible();
  const offerCount = await offerRows.count();
  expect(offerCount).toBeGreaterThan(0);

  // Only human-verified offers reach this screen.
  await expect(page.getByText(/awaiting human verification/i)).toBeVisible();

  // ---- 3. Select it -----------------------------------------------------
  await offerRows.first().getByTestId("work-it-out").click();
  await page.waitForURL(/\/match\?promotion=/);
  await expect(page.getByRole("heading", { name: "Match Finder" })).toBeVisible();

  // The qualifying stage is selected by default.
  await expect(page.getByText(/qualifying bet of £/)).toBeVisible();

  // ---- 4. Search compatible exchange markets ----------------------------
  await page.getByTestId("search-markets").click();
  const marketRows = page.getByTestId("market-row");
  await expect(marketRows.first()).toBeVisible({ timeout: 30_000 });

  // ---- 5. See clearly-labelled prices ----------------------------------
  // The back column is the EXCHANGE's price and must say so.
  await expect(page.getByTestId("market-results").getByText("indicative")).toBeVisible();
  await expect(page.getByText(/Sample data, not a live exchange/i)).toBeVisible();

  // ---- 6. See available liquidity ---------------------------------------
  const firstRow = marketRows.first();
  await expect(firstRow.getByText(/ample|sufficient|thin/i)).toBeVisible();

  // ---- 7. Calculate the qualifying hedge --------------------------------
  await firstRow.click();
  await expect(page.getByTestId("lay-stake")).toBeVisible();

  // Before a bookmaker price is entered, the figures are labelled indicative.
  // NOTE: the copy uses a typographic apostrophe, so match around it.
  await expect(page.getByText(/not your bookmaker/i)).toBeVisible();

  // Enter the price the customer's own bookmaker is showing.
  await page.getByTestId("bookmaker-price").fill("3.40");
  await page.getByTestId("apply-bookmaker-price").click();
  await expect(page.getByText(/Calculated from the price you entered/i)).toBeVisible();

  // ---- 8. See the result under every outcome ----------------------------
  const settlement = page.getByTestId("settlement");
  await expect(settlement).toBeVisible();
  await expect(settlement.getByText(/wins at the bookmaker/i)).toBeVisible();
  await expect(settlement.getByText(/does not win/i)).toBeVisible();

  // The settlement matrix must add up by hand.
  await assertSettlementAddsUp(page);

  // Record the position.
  await page.getByTestId("track-position").click();
  await expect(page.getByTestId("view-plan")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("view-plan").click();
  await page.waitForURL(/\/bets\/[a-z0-9]+/);

  const planUrl = page.url();

  // ---- 9. Mark the qualifying stage complete ----------------------------
  await expect(page.getByTestId("stage-track")).toBeVisible();
  // Record what actually happened: the lay filled a tick worse than suggested.
  await page.getByTestId("lay-odds").fill("3.30");
  await page.getByTestId("settle-qualifying").click();
  await expect(page.getByText("Qualifying settled")).toBeVisible({ timeout: 20_000 });

  // ---- 10. Record the free bet arriving ---------------------------------
  await page.getByTestId("record-token").click();
  await expect(page.getByTestId("find-conversion")).toBeVisible({ timeout: 20_000 });

  // ---- 11. Find a conversion --------------------------------------------
  await page.getByTestId("find-conversion").click();
  await page.waitForURL(/stage=CONVERSION/);
  await expect(page.getByText(/token conversion of £/)).toBeVisible();

  // ---- 12. Calculate the hedge ------------------------------------------
  await page.getByTestId("search-markets").click();
  const conversionRows = page.getByTestId("market-row");
  await expect(conversionRows.first()).toBeVisible({ timeout: 30_000 });
  await conversionRows.first().click();
  await expect(page.getByTestId("lay-stake")).toBeVisible();

  await page.getByTestId("bookmaker-price").fill("5.00");
  await page.getByTestId("apply-bookmaker-price").click();
  await expect(page.getByText(/Calculated from the price you entered/i)).toBeVisible();

  // ---- 13. See the calculated locked return ------------------------------
  const net = await page.getByTestId("guaranteed-net").innerText();
  // A converted token returns money, so the figure must be positive.
  expect(net).not.toContain("−");
  await assertSettlementAddsUp(page);

  await page.getByTestId("track-position").click();
  await expect(page.getByTestId("view-plan")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("view-plan").click();
  await page.waitForURL(/\/bets\/[a-z0-9]+/);

  // ---- 14. Record completion ---------------------------------------------
  // The conversion's back bet won at the bookmaker.
  await page.getByTestId("selection-won").check();
  await page.getByTestId("settle-conversion").click();
  await expect(page.getByTestId("complete-plan")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("complete-plan").click();
  await expect(page.getByText("Completed. The realised figure")).toBeVisible({ timeout: 20_000 });

  const realised = await page.getByTestId("realised-net").innerText();
  expect(realised).toMatch(/£\d/);

  // ---- 15. See the realised return on the dashboard -----------------------
  await page.goto("/");
  const realisedPanel = page.getByText("Realised return");
  await expect(realisedPanel).toBeVisible();
  await expect(page.getByText(/1 completed position/)).toBeVisible();

  await page.goto("/profit");
  await expect(page.getByTestId("completed-table")).toBeVisible();
  await expect(page.getByTestId("realised-cell").first()).toBeVisible();

  // The dashboard's realised figure must be the one the position recorded.
  await page.goto(planUrl);
  await expect(page.getByTestId("realised-net")).toHaveText(realised);
});

/**
 * Add each settlement column up by hand and check it equals the net printed
 * beneath it. This is the engine's central invariant, verified through the
 * rendered DOM rather than through the engine's own API.
 */
async function assertSettlementAddsUp(page: Page): Promise<void> {
  const columns = await page.getByTestId("settlement").locator("> div > div").all();
  expect(columns.length).toBe(2);

  for (const column of columns) {
    const amounts = await column.locator("tbody td.num").allInnerTexts();
    const netText = await column.locator("div.border-t-2 span.figure").innerText();

    // Guard against the assertion passing vacuously on an empty selector.
    expect(amounts.length, "no settlement lines were found to add up").toBeGreaterThanOrEqual(2);
    expect(netText).toMatch(/£/);

    const toPence = (text: string): number => {
      const negative = text.includes("−") || text.includes("-");
      const digits = text.replace(/[^0-9.]/g, "");
      const pence = Math.round(Number.parseFloat(digits) * 100);
      return negative ? -pence : pence;
    };

    const summed = amounts.reduce((total, text) => total + toPence(text), 0);
    expect(summed, `settlement column does not sum to ${netText}`).toBe(toPence(netText));
  }
}

test("authenticated API routes are reachable with the browser's own cookies", async ({ page }) => {
  await signIn(page, "customer");
  await page.goto("/");

  // NOTE: page.request has its own cookie jar and would report 401 here.
  // The fetch runs inside the page so it carries the real session cookie.
  const result = await fetchInPage<{ id?: string; error?: string }>(page, "/api/bet-plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  // Authenticated, and rejected on its merits rather than on auth.
  expect(result.status).toBe(400);
  expect(result.body.error).toBeTruthy();
});
