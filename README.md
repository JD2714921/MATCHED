# MATCHED

A UK-focused matched-betting intelligence platform.

It finds bookmaker promotional offers, interprets their terms, and calculates
the hedge across every outcome — removing the searching, the terms
interpretation and the arithmetic, while leaving the customer in control of
every actual bet.

**MATCHED is not a bookmaker and not a betting exchange.** It holds no funds and
places no bets. The customer opens their own operator accounts and places every
bet themselves.

## The governing principle

> AI interprets. Code calculates. APIs provide market data. Humans execute.

No language model is ever the source of a stake, liability, return or profit
figure. This is enforced, not promised:

- `lib/math` may import `decimal.js` and its own files and **nothing else**. A
  test walks its import graph, and `scripts/lint-safety.ts` checks it again
  independently.
- Every model-produced string bound for a customer passes through
  **NumericGuard** (`lib/ai/guard.ts`), which rejects any money or percentage
  figure that was not in the deterministic payload for that call.
- `scripts/lint-safety.ts` fails the build on bet-placement code, a place-bet
  UI control, a schema field that could hold a third-party credential, a payment
  integration, the engine losing its isolation, or arithmetic in the AI layer.
- `scripts/lint-copy.ts` fails the build on guaranteed-profit and risk-free
  claims, income claims, and language shading into evading operator
  restrictions or multi-accounting.

Both lints were verified by planting deliberate violations and watching each
one fail — see `scripts/__tests__/lints.test.ts`.

## Getting started

```bash
npm install
npm run db:up        # starts Postgres 16 on port 5433
cp .env.example .env
npm run db:push
npm run db:seed
npm run dev
```

Demonstration accounts are printed by the seed:

| Role | Email | Password |
| --- | --- | --- |
| Customer | `demo@matched.test` | `matched-demo-2026` |
| Administrator | `admin@matched.test` | `matched-admin-2026` |

## Verifying

```bash
npm run check        # typecheck + both lints + 247 unit tests
npm run test:e2e     # 12 Playwright tests, including the full journey
```

## What is real and what is not

| | Status |
| --- | --- |
| Calculation engine | Real. 73 tests, every golden value computed by hand |
| Exchange data | **Labelled sample data** by default. The Betfair client is written but **unverified** — see `docs/betfair-integration.md` |
| Terms interpretation | Real, deterministic and rule-based by default. The Anthropic adapter is written but unverified — no API key was available |
| Operators and their terms | **All invented.** No real operator's terms are reproduced anywhere |
| Legal position | **Unreviewed.** See `docs/legal-review.md` |

The fixture exchange provider reports `live: false` and says so on the admin
screen. Nothing in this product presents sample data as a live integration.

## The honesty point that shapes the product

**There is no bookmaker odds feed.** The back bet happens at a bookmaker; we
only have exchange data. So the exchange's best back price is used as an
*indicative* starting point for finding a workable market, is badged
`Indicative` everywhere it appears, and the customer is asked to enter the price
their own bookmaker is actually showing before anything is treated as real. That
entered price applies **only** to the selection they have open — a bookmaker's
price for one selection says nothing about another — and is discarded the moment
the selection changes.

Similarly, when recording bets the suggested figures are pre-filled but every
one is editable, and results are computed from what the customer actually got.
Lays fill worse than the screen showed; the profit tracker shows reality.

## Architecture

```
lib/math/         The calculation engine. Pure, isolated, decimal.js only.
lib/exchange/     ExchangeProvider interface, with fixture/ and betfair/.
lib/ai/           AiProvider interface, with stub/ and anthropic/, plus NumericGuard.
lib/promotions/   collect -> raw -> interpret -> validate -> gate -> HUMAN -> published.
lib/scoring/      Transparent weighted scoring. No LLM involvement.
lib/auth/         scrypt + opaque session tokens.
app/              Next.js App Router. Eight screens plus admin.
scripts/          The two lints, the dev database, the Betfair verifier.
```

### The calculation engine

Notation: `B` back stake, `b` back odds, `l` lay odds, `c` commission, `S` lay
stake.

| | Lay stake | Back wins | Back loses |
| --- | --- | --- | --- |
| Qualifying | `B·b / (l − c)` | `B(b−1) − S(l−1)` | `S(1−c) − B` |
| Free bet, SNR | `B(b−1) / (l − c)` | `B(b−1) − S(l−1)` | `S(1−c)` |
| Free bet, SR | `B·b / (l − c)` | `B·b − S(l−1)` | `S(1−c)` |

Two properties matter more than the formulas:

1. **Both outcomes are always recomputed from the ROUNDED lay stake.** The
   idealised equalised figure is reported for transparency and used for nothing,
   because a customer cannot place a fraction of a penny. Five rounding modes
   are supported.
2. **Every outcome carries a settlement matrix whose rounded line items sum
   exactly to its net.** Each line is rounded to pence first, and the net is
   their sum — so the column adds up by hand. The matrix is a proof of the
   number, not a restatement of it.

Money is `NUMERIC(14,2)`, odds and rates `NUMERIC(10,4)`. Prisma maps both to
`decimal.js` instances, so money never becomes a float, and decimals cross every
API boundary as **strings**.

## Environment notes

Discovered the hard way, and encoded so they need not be rediscovered:

- **`typescript` is pinned to `^6`.** npm's `latest` is 7.x, which Next 15.5
  rejects outright.
- **`next.config.mjs`, not `.ts`** — the TypeScript config fails to load.
- **`types/globals.d.ts` declares `*.css`**, which TS 6 needs for side-effect
  CSS imports.
- **Playwright points at `/opt/pw-browsers/chromium`.** Do not run
  `playwright install`.
- **`reuseExistingServer` is `false`**, so a stale `next start` can never serve
  an old build into a test run.
- **Postgres runs as the `postgres` user** via `scripts/dev-db.sh`; it refuses
  to run as root, and there is no service and no Docker daemon here.
- **`prisma migrate reset` needs interactive consent** and will refuse. The seed
  deletes rows directly instead.
- **`page.request` does not share the browser's cookie jar** in Playwright.
  `e2e/helpers.ts` fetches from inside the page instead.

## Responsible gambling

Gambling can be harmful. Free, confidential support is available from GamCare on
0808 8020 133 and at begambleaware.org. You must be 18 or over.
