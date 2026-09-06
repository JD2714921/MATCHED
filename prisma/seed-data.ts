import type { CollectionMethod, PromotionKind } from "@prisma/client";

/**
 * Seed content.
 *
 * Every operator here is INVENTED, and so is every word of every set of terms.
 * Reproducing a real bookmaker's promotional terms would be someone else's
 * copyright, and listing real operators would imply a commercial relationship
 * that does not exist. The names below are deliberately unlike any real brand.
 */

export interface SeedOperator {
  name: string;
  slug: string;
  websiteUrl: string;
  notes: string;
  sources: SeedSource[];
}

export interface SeedSource {
  name: string;
  collectionMethod: CollectionMethod;
  url?: string;
  /** Only ever true for a method that does not fetch from someone's site. */
  approved?: boolean;
  captures: SeedCapture[];
}

export interface SeedCapture {
  title: string;
  /** Invented terms, written in the register real terms are written in. */
  rawText: string;
  /** Whether the seed should publish this after interpretation. */
  publish: boolean;
  expectedKind: PromotionKind;
}

export const SEED_OPERATORS: SeedOperator[] = [
  {
    name: "Northgate Bet",
    slug: "northgate-bet",
    websiteUrl: "https://northgate.example",
    notes: "Fictional operator used for demonstration and testing.",
    sources: [
      {
        name: "Northgate Bet — promotions page",
        collectionMethod: "MANUAL_ENTRY",
        url: "https://northgate.example/promotions",
        captures: [
          {
            title: "Bet £10 — Get £30 in Free Bets",
            publish: true,
            expectedKind: "SIGN_UP",
            rawText: `New customers only. Register an account and place a qualifying bet of £10 at minimum odds of 1.50 on any Football, Tennis or Horse Racing market.

Once your qualifying bet has settled we will credit 3 x £10 free bets to your account within 24 hours.

The free bet stake is not returned with any winnings. Free bets expire 7 days after being credited and cannot be withdrawn. Minimum odds of 1.20 apply to the free bet.

One promotion per customer, household or IP address. Payment method restrictions apply.`,
          },
        ],
      },
    ],
  },
  {
    name: "Kestrel Sports",
    slug: "kestrel-sports",
    websiteUrl: "https://kestrel.example",
    notes: "Fictional operator. Carries the stake-returned variant, for contrast.",
    sources: [
      {
        name: "Kestrel Sports — welcome offer",
        collectionMethod: "OPERATOR_AFFILIATE_FEED",
        url: "https://kestrel.example/welcome",
        approved: true,
        captures: [
          {
            title: "Bet £20 — Get a £20 Free Bet",
            publish: true,
            expectedKind: "SIGN_UP",
            rawText: `Open a new account and bet £20 at minimum odds of evens (2.0) or greater on any sport.

When your first bet settles we will credit one £20 free bet.

Your free bet stake is returned with any winnings. The free bet must be used within 14 days of being credited.

New customers only. Full terms apply.`,
          },
        ],
      },
    ],
  },
  {
    name: "Halyard Bet",
    slug: "halyard-bet",
    websiteUrl: "https://halyard.example",
    notes: "Fictional operator. Recurring offer for existing customers.",
    sources: [
      {
        name: "Halyard Bet — weekly offers",
        collectionMethod: "MANUAL_ENTRY",
        url: "https://halyard.example/weekly",
        captures: [
          {
            title: "£10 Weekly Reload — Every Saturday",
            publish: true,
            expectedKind: "RELOAD",
            rawText: `Existing customers only. Place a bet of £10 or more on any Football market at minimum odds of 1/2 on a Saturday.

We will credit a £10 free bet the following Monday.

The free bet stake is not included in any returns. Free bets expire 5 days after being credited.

Available once per customer per week.`,
          },
        ],
      },
    ],
  },
  {
    name: "Copperline Sports",
    slug: "copperline-sports",
    websiteUrl: "https://copperline.example",
    notes: "Fictional operator. Insurance-style offer.",
    sources: [
      {
        name: "Copperline Sports — acca insurance",
        collectionMethod: "MANUAL_ENTRY",
        url: "https://copperline.example/acca",
        captures: [
          {
            title: "Acca Insurance — Money Back up to £25 as a Free Bet",
            publish: true,
            expectedKind: "ACCA_INSURANCE",
            rawText: `Place an accumulator of five or more selections on Football at minimum odds of 2.00 per selection.

If exactly one selection lets you down we will refund your stake as a free bet, up to £25.

The free bet stake is not returned. Free bets expire 7 days after being credited.

Cash out bets do not qualify. One refund per customer per day.`,
          },
        ],
      },
    ],
  },
  {
    name: "Example Bookmaker",
    slug: "example-bookmaker",
    websiteUrl: "https://example-bookmaker.example",
    notes:
      "Fictional operator carrying a deliberately unreadable offer, so the Needs Verification path is always exercised.",
    sources: [
      {
        name: "Example Bookmaker — seasonal promotions",
        collectionMethod: "PUBLIC_PAGE_FETCH",
        url: "https://example-bookmaker.example/promotions",
        // Deliberately NOT approved: an automated fetch from someone's own
        // site stays off until an administrator records both checks.
        approved: false,
        captures: [
          {
            title: "Weekend Boost — Rewards for Selected Customers",
            publish: false,
            expectedKind: "OTHER",
            rawText: `Bet £20 on selected markets this weekend and you may receive a reward.

Rewards are credited at our discretion once the promotion closes, and the value awarded may vary between customers.

Rewards must be used before the promotion period ends. Other terms may apply.

This promotion may be varied or withdrawn at any time.`,
          },
        ],
      },
    ],
  },
];

export const DEMO_USERS = {
  customer: {
    email: "demo@matched.test",
    displayName: "Demo Customer",
    password: "matched-demo-2026",
  },
  admin: {
    email: "admin@matched.test",
    displayName: "Demo Administrator",
    password: "matched-admin-2026",
  },
} as const;
