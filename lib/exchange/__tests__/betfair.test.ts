import { describe, it, expect } from "vitest";
import {
  ALLOWED_OPERATIONS,
  REFUSED_OPERATIONS,
  ForbiddenOperationError,
  assertAllowedOperation,
  isAllowedOperation,
  batchMarketIds,
  maxMarketsPerCall,
  normaliseProjections,
  projectionWeight,
} from "../betfair/operations";
import { BetfairClient, BETFAIR_JSONRPC_URL, BETFAIR_CERTLOGIN_URL } from "../betfair/client";
import { BetfairExchangeProvider } from "../betfair/provider";
import { FixtureExchangeProvider } from "../fixture/provider";
import { FORBIDDEN_METHOD_PATTERNS, surfaceMethodNames } from "../provider";

describe("read-only by construction", () => {
  it("refuses every order-placing operation by name", () => {
    for (const operation of REFUSED_OPERATIONS) {
      expect(() => assertAllowedOperation(operation)).toThrow(ForbiddenOperationError);
      expect(isAllowedOperation(operation)).toBe(false);
    }
  });

  it("refuses an operation it has never heard of", () => {
    expect(() => assertAllowedOperation("placeOrdersV2")).toThrow(ForbiddenOperationError);
    expect(() => assertAllowedOperation("transferFunds")).toThrow(ForbiddenOperationError);
  });

  it("explains the refusal in terms a reader can act on", () => {
    try {
      assertAllowedOperation("placeOrders");
      throw new Error("should have refused");
    } catch (cause) {
      expect((cause as Error).message).toContain("read-only");
      expect((cause as Error).message).toContain("never places");
    }
  });

  it("allows only list* market-data operations", () => {
    for (const operation of ALLOWED_OPERATIONS) {
      expect(operation.startsWith("list")).toBe(true);
      expect(() => assertAllowedOperation(operation)).not.toThrow();
    }
  });

  it("exposes no bet-placing method on the client's runtime surface", () => {
    // A TypeScript `private` keyword is erased at compile time and would leave
    // the method callable. The client uses `#private` members, so they are not
    // on the surface at all — this test is what proves it.
    const names = surfaceMethodNames(BetfairClient.prototype);
    for (const name of names) {
      for (const pattern of FORBIDDEN_METHOD_PATTERNS) {
        expect(
          pattern.test(name),
          `BetfairClient exposes "${name}", which matches ${pattern}`,
        ).toBe(false);
      }
    }
  });

  it("exposes no bet-placing method on either provider", () => {
    for (const prototype of [
      BetfairExchangeProvider.prototype,
      FixtureExchangeProvider.prototype,
    ]) {
      for (const name of surfaceMethodNames(prototype)) {
        for (const pattern of FORBIDDEN_METHOD_PATTERNS) {
          expect(pattern.test(name), `${name} matches ${pattern}`).toBe(false);
        }
      }
    }
  });

  it("keeps internals off the public surface", () => {
    const names = surfaceMethodNames(BetfairClient.prototype);
    expect(names).toContain("call");
    expect(names).toContain("login");
    expect(names).toContain("listMarketBook");
    // #rpc and #httpsPost must not be reachable.
    expect(names.some((n) => n.includes("rpc"))).toBe(false);
    expect(names.some((n) => n.includes("httpsPost"))).toBe(false);
  });
});

describe("endpoints", () => {
  it("uses the documented certlogin and JSON-RPC endpoints", () => {
    expect(BETFAIR_CERTLOGIN_URL).toBe("https://identitysso-cert.betfair.com/api/certlogin");
    expect(BETFAIR_JSONRPC_URL).toBe("https://api.betfair.com/exchange/betting/json-rpc/v1");
  });
});

describe("market data request limit", () => {
  it("weighs EX_BEST_OFFERS at 5, giving the familiar 40 markets per call", () => {
    expect(projectionWeight(["EX_BEST_OFFERS"])).toBe(5);
    expect(maxMarketsPerCall(["EX_BEST_OFFERS"])).toBe(40);
  });

  it("weighs EX_ALL_OFFERS at 17", () => {
    expect(projectionWeight(["EX_ALL_OFFERS"])).toBe(17);
    // floor(200 / 17) = 11
    expect(maxMarketsPerCall(["EX_ALL_OFFERS"])).toBe(11);
  });

  it("lets EX_ALL_OFFERS supersede EX_BEST_OFFERS rather than adding to it", () => {
    expect(normaliseProjections(["EX_BEST_OFFERS", "EX_ALL_OFFERS"])).toEqual(["EX_ALL_OFFERS"]);
    // 17, not 22.
    expect(projectionWeight(["EX_BEST_OFFERS", "EX_ALL_OFFERS"])).toBe(17);
  });

  it("adds the weights of projections that do not supersede one another", () => {
    // EX_BEST_OFFERS 5 + EX_TRADED 17 = 22 -> floor(200/22) = 9
    expect(projectionWeight(["EX_BEST_OFFERS", "EX_TRADED"])).toBe(22);
    expect(maxMarketsPerCall(["EX_BEST_OFFERS", "EX_TRADED"])).toBe(9);
  });

  it("ignores a repeated projection", () => {
    expect(projectionWeight(["EX_BEST_OFFERS", "EX_BEST_OFFERS"])).toBe(5);
  });

  it("rejects a projection it does not know the weight of", () => {
    expect(() => projectionWeight(["EX_MADE_UP"])).toThrow(/Unknown Betfair price projection/);
  });

  it("batches market ids so no call can exceed the limit", () => {
    const ids = Array.from({ length: 95 }, (_, i) => `1.${i}`);
    const batches = batchMarketIds(ids, ["EX_BEST_OFFERS"]);
    expect(batches.map((b) => b.length)).toEqual([40, 40, 15]);
    for (const batch of batches) {
      expect(projectionWeight(["EX_BEST_OFFERS"]) * batch.length).toBeLessThanOrEqual(200);
    }
  });

  it("batches more tightly for the heavier projection", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `1.${i}`);
    const batches = batchMarketIds(ids, ["EX_ALL_OFFERS"]);
    expect(batches.map((b) => b.length)).toEqual([11, 11, 3]);
  });

  it("returns no batches for no markets", () => {
    expect(batchMarketIds([], ["EX_BEST_OFFERS"])).toEqual([]);
  });
});
