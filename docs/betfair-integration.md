# Betfair integration — what is and is not verified

**Status: UNVERIFIED against the live service.**

This document exists so that nobody — reading the code, the tests, or a
demonstration — concludes that MATCHED has a working Betfair integration. It
does not, yet.

## Why it is unverified

The environment this was built in cannot reach Betfair. Both endpoints are
refused by the egress proxy at the CONNECT stage:

```
$ curl -sS https://api.betfair.com/exchange/betting/json-rpc/v1
curl: (56) CONNECT tunnel failed, response 403

$ curl -sS https://identitysso-cert.betfair.com/api/certlogin
curl: (56) CONNECT tunnel failed, response 403
```

No credentials, certificate or application key were available either. The
Betfair client has therefore never made a single request to Betfair.

## What IS verified

These hold today and are covered by tests in
`lib/exchange/__tests__/betfair.test.ts`:

| Claim | How it is verified |
| --- | --- |
| The client cannot place, amend or cancel a bet | The operation whitelist is asserted before any socket is opened, and `placeOrders`, `cancelOrders`, `replaceOrders` and `updateOrders` are each shown to throw |
| No bet-shaped method exists on the runtime surface | A test walks the prototype chain of the client and both providers and matches every property name against a forbidden-pattern list |
| Internals are genuinely private | `#private` methods, not TypeScript's `private` keyword, which is erased at compile time and would leave the method callable; the surface test proves `#rpc` and `#httpsPost` are unreachable |
| The request weight limit is respected | `sum(weight) × marketCount ≤ 200`, with EX_BEST_OFFERS at 5 (hence 40 markets per call) and EX_ALL_OFFERS at 17 superseding rather than adding to it; batching is tested against 95 and 25 market ids |
| Delayed-key handling | A stub client returns a book containing `totalMatched`, and the provider is shown to report `null` on a delayed key rather than passing the figure on or substituting zero |
| The exchange's delay flag is carried, not inferred | `isMarketDataDelayed` is taken from Betfair's own response and surfaced unchanged |
| JSON floats do not corrupt money | Numbers are converted to `Decimal` through their string form immediately, before any arithmetic |
| Endpoint URLs and method namespace | Asserted as string constants against the documented values |

## What is NOT verified

Everything that requires Betfair to answer:

- **Certificate login.** `node:https` is used rather than `fetch`, because
  `fetch` cannot present a client certificate and Betfair's certlogin endpoint
  requires mutual TLS. The code path has never run against the real endpoint.
- **The JSON-RPC envelope.** Whether `SportsAPING/v1.0/<operation>`, the
  `X-Application` and `X-Authentication` headers, and the params shapes are
  accepted as written.
- **Response shapes.** The interfaces in `lib/exchange/betfair/provider.ts` were
  written from Betfair's documentation, not from observed responses. Field
  names, nesting and optionality may differ.
- **Session lifetime.** A 12-minute refresh is used against a documented
  20-minute idle timeout. Untested.
- **Error handling.** Which errors Betfair actually returns, and whether the
  retryable classification (`TOO_MUCH_DATA`, `TIMEOUT`, `SERVICE_BUSY`) matches
  reality.
- **The real weight limit.** The arithmetic is implemented to the documented
  rule; whether Betfair accepts a 40-market EX_BEST_OFFERS call in practice is
  unconfirmed.
- **Whether `availableToLay` sizes mean what we assume.** We treat the `size` on
  an `availableToLay` level as the lay stake the customer would place. This
  matches the documentation but has not been checked against a live book.

## How to verify it

Where egress to Betfair is permitted, set the credentials in `.env`:

```
EXCHANGE_PROVIDER=betfair
BETFAIR_APP_KEY=...
BETFAIR_USERNAME=...
BETFAIR_PASSWORD=...
BETFAIR_CERT_PATH=/path/to/client-2048.crt
BETFAIR_KEY_PATH=/path/to/client-2048.key
BETFAIR_KEY_IS_DELAYED=true
```

Then:

```
npm run verify:betfair
```

It runs read operations only — it goes through the same whitelist as the
application and cannot place a bet — and reports on login, `listEventTypes`,
`listEvents`, `listMarketCatalogue`, `listMarketBook`, the delay flag, the
traded-volume handling, and batching a 45-market request.

When it passes, record the date and the application-key type below, and change
the status line at the top of this file. Until then, the status line stands.

| Date | App key type | Result | Notes |
| --- | --- | --- | --- |
| — | — | Never run against the live service | Egress blocked in the build environment |

## The delayed application key

A DELAYED key is the default for a new Betfair application, and it changes what
the product can honestly say:

- **Prices are snapshot-delayed.** Betfair reports this per market via
  `isMarketDataDelayed`, and MATCHED carries that flag through to a visible
  badge on every price rather than inferring or defaulting it.
- **There is no traded volume.** The product therefore reports volume as *not
  available on this key* rather than estimating it. An estimate presented as a
  fact would be exactly the kind of invented figure this product exists to
  avoid.
- **Liquidity is measured from ladder depth.** `availableToLay` cumulative size
  at prices at or better than the target — never from traded volume.

## Running without Betfair

`EXCHANGE_PROVIDER=fixture` (the default) uses a labelled sample-data provider.
Its `healthCheck()` reports `live: false` and says "No exchange has been
contacted; every price shown is invented and labelled as such", and the admin
screen shows that message verbatim. Sample data cannot be mistaken for a
working integration by anyone reading the screen.

If `EXCHANGE_PROVIDER=betfair` is set with incomplete credentials, the factory
falls back to the fixture provider and logs a warning. It does not pretend to
be Betfair.
