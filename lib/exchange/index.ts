import { env } from "@/lib/env";
import { childLogger } from "@/lib/logger";
import type { ExchangeProvider } from "./provider";
import { FixtureExchangeProvider } from "./fixture/provider";
import { BetfairExchangeProvider } from "./betfair/provider";

const log = childLogger("exchange");

export * from "./types";
export { ExchangeError, FORBIDDEN_METHOD_PATTERNS, surfaceMethodNames } from "./provider";
export type { ExchangeProvider } from "./provider";
export { FixtureExchangeProvider, fixtureProviderAt } from "./fixture/provider";
export { BetfairExchangeProvider } from "./betfair/provider";
export { BetfairClient } from "./betfair/client";
export * from "./betfair/operations";
export { tickSize, toValidPrice, stepPrice } from "./ticks";

let cached: ExchangeProvider | null = null;

/**
 * Build the configured provider.
 *
 * Defaults to the fixture provider. Selecting `betfair` requires a complete
 * set of credentials — a half-configured live provider falls back to fixtures
 * with a loud warning rather than failing silently at request time, because a
 * silent fallback that still SAID it was Betfair would be the fabricated
 * integration this product must never ship.
 */
export function getExchangeProvider(): ExchangeProvider {
  if (cached) return cached;
  cached = buildProvider();
  return cached;
}

function buildProvider(): ExchangeProvider {
  if (env.EXCHANGE_PROVIDER !== "betfair") {
    return new FixtureExchangeProvider();
  }

  const missing = (
    [
      ["BETFAIR_APP_KEY", env.BETFAIR_APP_KEY],
      ["BETFAIR_USERNAME", env.BETFAIR_USERNAME],
      ["BETFAIR_PASSWORD", env.BETFAIR_PASSWORD],
      ["BETFAIR_CERT_PATH", env.BETFAIR_CERT_PATH],
      ["BETFAIR_KEY_PATH", env.BETFAIR_KEY_PATH],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    log.warn(
      { missing },
      "EXCHANGE_PROVIDER=betfair but credentials are incomplete; using the labelled sample provider instead",
    );
    return new FixtureExchangeProvider();
  }

  return new BetfairExchangeProvider({
    appKey: env.BETFAIR_APP_KEY!,
    username: env.BETFAIR_USERNAME!,
    password: env.BETFAIR_PASSWORD!,
    certPath: env.BETFAIR_CERT_PATH!,
    keyPath: env.BETFAIR_KEY_PATH!,
    keyIsDelayed: env.BETFAIR_KEY_IS_DELAYED,
  });
}

/** Test seam. */
export function resetExchangeProvider(): void {
  cached = null;
}
