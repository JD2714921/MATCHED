import type { Page } from "@playwright/test";

export const ACCOUNTS = {
  customer: { email: "demo@matched.test", password: "matched-demo-2026" },
  admin: { email: "admin@matched.test", password: "matched-admin-2026" },
} as const;

/** Sign in through the real form, so the session cookie is set the real way. */
export async function signIn(page: Page, who: keyof typeof ACCOUNTS = "customer"): Promise<void> {
  const account = ACCOUNTS[who];
  await page.goto("/login");
  await page.fill("#email", account.email);
  await page.fill("#password", account.password);
  await Promise.all([page.waitForURL("**/"), page.click('button[type="submit"]')]);
}

/**
 * Call an authenticated API route from INSIDE the page.
 *
 * Playwright's `page.request` has its own cookie jar and does NOT share the
 * browser's, so a route behind a session cookie appears unauthenticated
 * through it. Running fetch in the page context uses the real cookies.
 */
export async function fetchInPage<T>(
  page: Page,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ([target, options]) => {
      const response = await fetch(target as string, (options ?? undefined) as RequestInit);
      return { status: response.status, body: (await response.json()) as never };
    },
    [url, init ?? null] as const,
  );
}
