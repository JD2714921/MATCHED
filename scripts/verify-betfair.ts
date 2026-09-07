#!/usr/bin/env tsx
/**
 * Verify the Betfair integration against the live service.
 *
 * This exists because the Betfair client has NEVER been run against Betfair.
 * The environment it was written in cannot reach api.betfair.com or
 * identitysso-cert.betfair.com — the egress proxy refuses the CONNECT tunnel
 * with a 403 — so every claim about that integration is a claim about code
 * that compiles and is unit-tested against recorded response shapes, which is
 * not the same as working.
 *
 * Run this where egress is allowed, with real credentials, and it will say
 * plainly which of those claims hold.
 *
 *   npm run verify:betfair
 *
 * It performs READ operations only. It cannot place a bet: every call goes
 * through the same operation whitelist as the application.
 */
import { BetfairClient } from "@/lib/exchange/betfair/client";
import { BetfairExchangeProvider } from "@/lib/exchange/betfair/provider";
import { ALLOWED_OPERATIONS, assertAllowedOperation } from "@/lib/exchange/betfair/operations";
import { env } from "@/lib/env";

interface Check {
  name: string;
  run: () => Promise<string>;
}

let passed = 0;
let failed = 0;

async function report(check: Check): Promise<void> {
  process.stdout.write(`  ${check.name} … `);
  try {
    const detail = await check.run();
    passed += 1;
    console.log(`ok${detail ? ` — ${detail}` : ""}`);
  } catch (cause) {
    failed += 1;
    console.log(`FAILED\n      ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function requireCredentials(): {
  appKey: string;
  username: string;
  password: string;
  certPath: string;
  keyPath: string;
  keyIsDelayed: boolean;
} {
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
    console.error(`\nCannot verify: ${missing.join(", ")} not set.`);
    console.error("Set them in .env and run again where api.betfair.com is reachable.\n");
    process.exit(2);
  }

  return {
    appKey: env.BETFAIR_APP_KEY!,
    username: env.BETFAIR_USERNAME!,
    password: env.BETFAIR_PASSWORD!,
    certPath: env.BETFAIR_CERT_PATH!,
    keyPath: env.BETFAIR_KEY_PATH!,
    keyIsDelayed: env.BETFAIR_KEY_IS_DELAYED,
  };
}

async function main(): Promise<void> {
  console.log("\nMATCHED — Betfair integration verification");
  console.log("==========================================\n");

  console.log("Offline checks (these pass anywhere):\n");

  await report({
    name: "the operation whitelist refuses order placement",
    run: async () => {
      for (const operation of ["placeOrders", "cancelOrders", "replaceOrders", "updateOrders"]) {
        let refused = false;
        try {
          assertAllowedOperation(operation);
        } catch {
          refused = true;
        }
        if (!refused) throw new Error(`${operation} was NOT refused`);
      }
      return `${ALLOWED_OPERATIONS.length} read operations allowed, order placement refused`;
    },
  });

  const credentials = requireCredentials();

  console.log("\nLive checks (these require egress to Betfair):\n");

  const client = new BetfairClient(credentials);
  const provider = new BetfairExchangeProvider(credentials, client);

  await report({
    name: "certificate login at identitysso-cert.betfair.com",
    run: async () => {
      await client.login();
      if (!client.hasSession) throw new Error("login returned without a session token");
      return "session established";
    },
  });

  let sportId: string | null = null;

  await report({
    name: "listEventTypes over JSON-RPC",
    run: async () => {
      const sports = await provider.getSports();
      if (sports.length === 0) throw new Error("no sports returned");
      sportId = sports.find((s) => s.name === "Soccer")?.id ?? sports[0]!.id;
      return `${sports.length} sports`;
    },
  });

  let marketId: string | null = null;

  await report({
    name: "listEvents and listMarketCatalogue",
    run: async () => {
      if (!sportId) throw new Error("skipped: no sport id");
      const events = await provider.getEvents({ sportId, limit: 3 });
      if (events.length === 0) throw new Error("no events returned");
      const markets = await provider.getMarkets(events[0]!.id);
      if (markets.length === 0) throw new Error("no markets returned");
      marketId = markets[0]!.id;
      return `${events.length} events, ${markets.length} markets on the first`;
    },
  });

  await report({
    name: "listMarketBook returns prices on both sides",
    run: async () => {
      if (!marketId) throw new Error("skipped: no market id");
      const [prices] = await provider.getPrices([marketId]);
      if (!prices) throw new Error("no price book returned");
      const withLay = prices.selections.filter((s) => s.availableToLay.length > 0);
      if (withLay.length === 0) throw new Error("no lay prices on any selection");
      return `${prices.selections.length} selections, ${withLay.length} with a lay price`;
    },
  });

  await report({
    name: "the delay flag is reported, not inferred",
    run: async () => {
      if (!marketId) throw new Error("skipped: no market id");
      const [prices] = await provider.getPrices([marketId]);
      if (!prices) throw new Error("no price book returned");
      return `isMarketDataDelayed=${prices.isMarketDataDelayed}, tradedVolumeAvailable=${prices.tradedVolumeAvailable}`;
    },
  });

  await report({
    name: "traded volume matches what the key licenses",
    run: async () => {
      if (!marketId) throw new Error("skipped: no market id");
      const [prices] = await provider.getPrices([marketId]);
      if (!prices) throw new Error("no price book returned");
      const anyVolume = prices.selections.some((s) => s.totalMatched !== null);
      if (credentials.keyIsDelayed && anyVolume) {
        throw new Error(
          "a DELAYED key reported traded volume — the delayed-key handling is wrong",
        );
      }
      return credentials.keyIsDelayed
        ? "delayed key, volume correctly reported as unavailable"
        : `live key, volume ${anyVolume ? "present" : "absent"}`;
    },
  });

  await report({
    name: "the market-data request limit holds for a large batch",
    run: async () => {
      if (!marketId) throw new Error("skipped: no market id");
      // 45 ids exceeds the 40-market ceiling for EX_BEST_OFFERS, so this only
      // succeeds if the client batched rather than sending them in one call.
      const ids = Array.from({ length: 45 }, () => marketId!);
      const books = await client.listMarketBook(ids, ["EX_BEST_OFFERS"]);
      return `${books.length} book(s) returned across batches`;
    },
  });

  console.log(`\n${passed} passed, ${failed} failed.\n`);

  if (failed > 0) {
    console.log("The integration is NOT verified. Do not describe it as working.\n");
    process.exitCode = 1;
  } else {
    console.log("All checks passed against the live service.");
    console.log("Record the date and the app-key type in docs/betfair-integration.md.\n");
  }
}

main().catch((cause) => {
  console.error("\nVerification aborted:", cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
