import { request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import { childLogger } from "@/lib/logger";
import { ExchangeError } from "../provider";
import {
  assertAllowedOperation,
  batchMarketIds,
  type AllowedOperation,
} from "./operations";

const log = childLogger("betfair");

export const BETFAIR_CERTLOGIN_URL = "https://identitysso-cert.betfair.com/api/certlogin";
export const BETFAIR_JSONRPC_URL = "https://api.betfair.com/exchange/betting/json-rpc/v1";
export const BETFAIR_API_NAMESPACE = "SportsAPING/v1.0";

export interface BetfairCredentials {
  appKey: string;
  username: string;
  password: string;
  /** Path to the client certificate Betfair issued for this application. */
  certPath: string;
  keyPath: string;
  /**
   * A DELAYED application key returns snapshot-delayed prices and no traded
   * volume. Carried through to every response so the UI can badge it.
   */
  keyIsDelayed: boolean;
}

interface CertLoginResponse {
  sessionToken?: string;
  loginStatus?: string;
}

/**
 * Betfair JSON-RPC client.
 *
 * READ-ONLY BY CONSTRUCTION. Every call goes through `#rpc`, which calls
 * `assertAllowedOperation` before a socket is opened. There is no method on
 * this class that places, changes or cancels an order, and the operation
 * whitelist would refuse one even if a caller tried.
 *
 * Internals use `#private` fields and methods rather than TypeScript's
 * `private` keyword. `private` is erased at compile time and would leave a
 * callable method on the runtime object; `#` does not exist outside the class
 * at all, which is what a surface test can actually verify.
 *
 * UNVERIFIED AGAINST THE LIVE SERVICE. See docs/betfair-integration.md.
 */
export class BetfairClient {
  readonly #credentials: BetfairCredentials;
  readonly #cert: Buffer;
  readonly #key: Buffer;

  #sessionToken: string | null = null;
  #sessionObtainedAt: number | null = null;

  /** Betfair sessions idle out after 20 minutes; refresh well inside that. */
  static readonly SESSION_TTL_MS = 12 * 60 * 1000;

  constructor(credentials: BetfairCredentials) {
    this.#credentials = credentials;
    // Read once at construction so a missing file fails loudly at startup
    // rather than on the first customer request.
    try {
      this.#cert = readFileSync(credentials.certPath);
      this.#key = readFileSync(credentials.keyPath);
    } catch (cause) {
      throw new ExchangeError(
        "BETFAIR_CERT_UNREADABLE",
        `Could not read the Betfair client certificate or key (${credentials.certPath}, ${credentials.keyPath}).`,
      );
    }
  }

  get keyIsDelayed(): boolean {
    return this.#credentials.keyIsDelayed;
  }

  get hasSession(): boolean {
    return this.#sessionToken !== null && !this.#sessionExpired();
  }

  /**
   * Certificate login.
   *
   * Uses node:https directly because `fetch` cannot present a client
   * certificate — there is no option on RequestInit for one, and Betfair's
   * certlogin endpoint requires mutual TLS.
   */
  async login(): Promise<void> {
    const body = new URLSearchParams({
      username: this.#credentials.username,
      password: this.#credentials.password,
    }).toString();

    const raw = await this.#httpsPost(BETFAIR_CERTLOGIN_URL, body, {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Application": this.#credentials.appKey,
      Accept: "application/json",
    });

    let parsed: CertLoginResponse;
    try {
      parsed = JSON.parse(raw) as CertLoginResponse;
    } catch {
      throw new ExchangeError(
        "BETFAIR_LOGIN_UNPARSEABLE",
        "Betfair's login response was not JSON.",
      );
    }

    if (parsed.loginStatus !== "SUCCESS" || !parsed.sessionToken) {
      throw new ExchangeError(
        "BETFAIR_LOGIN_FAILED",
        `Betfair login failed: ${parsed.loginStatus ?? "no status returned"}.`,
      );
    }

    this.#sessionToken = parsed.sessionToken;
    this.#sessionObtainedAt = Date.now();
    log.info({ loginStatus: parsed.loginStatus }, "betfair session established");
  }

  /**
   * Call a whitelisted read operation.
   *
   * `assertAllowedOperation` runs first, before any network activity.
   */
  async call<T>(operation: AllowedOperation, params: Record<string, unknown>): Promise<T> {
    assertAllowedOperation(operation);
    return this.#rpc<T>(operation, params);
  }

  /**
   * listMarketBook, batched to respect the request weight limit.
   *
   * Betfair enforces sum(weight) * marketCount <= 200 per call; the caller
   * simply asks for the markets it wants and gets them back in order.
   */
  async listMarketBook<T>(
    marketIds: string[],
    priceProjection: string[],
    extra: Record<string, unknown> = {},
  ): Promise<T[]> {
    const results: T[] = [];
    for (const batch of batchMarketIds(marketIds, priceProjection)) {
      const page = await this.call<T[]>("listMarketBook", {
        marketIds: batch,
        priceProjection: { priceData: priceProjection, virtualise: true },
        ...extra,
      });
      results.push(...page);
    }
    return results;
  }

  async #rpc<T>(operation: string, params: Record<string, unknown>): Promise<T> {
    // Belt and braces: the public entry point already asserted, but #rpc is
    // the only place a socket is opened, so it asserts too.
    assertAllowedOperation(operation);

    if (!this.hasSession) await this.login();

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      method: `${BETFAIR_API_NAMESPACE}/${operation}`,
      params,
      id: 1,
    });

    const raw = await this.#httpsPost(BETFAIR_JSONRPC_URL, payload, {
      "Content-Type": "application/json",
      "X-Application": this.#credentials.appKey,
      "X-Authentication": this.#sessionToken ?? "",
      Accept: "application/json",
    });

    let parsed: { result?: T; error?: { message?: string; data?: unknown } };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      throw new ExchangeError(
        "BETFAIR_RESPONSE_UNPARSEABLE",
        `Betfair returned a non-JSON response to ${operation}.`,
      );
    }

    if (parsed.error) {
      const message = parsed.error.message ?? "unknown error";
      throw new ExchangeError(
        "BETFAIR_API_ERROR",
        `Betfair rejected ${operation}: ${message}`,
        /TOO_MUCH_DATA|TIMEOUT|SERVICE_BUSY/.test(message),
      );
    }

    if (parsed.result === undefined) {
      throw new ExchangeError(
        "BETFAIR_EMPTY_RESULT",
        `Betfair returned no result for ${operation}.`,
      );
    }

    return parsed.result;
  }

  #sessionExpired(): boolean {
    if (this.#sessionObtainedAt === null) return true;
    return Date.now() - this.#sessionObtainedAt > BetfairClient.SESSION_TTL_MS;
  }

  #httpsPost(
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const target = new URL(url);
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          host: target.hostname,
          port: target.port || 443,
          path: target.pathname + target.search,
          method: "POST",
          headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
          cert: this.#cert,
          key: this.#key,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if ((res.statusCode ?? 0) >= 400) {
              reject(
                new ExchangeError(
                  "BETFAIR_HTTP_ERROR",
                  `Betfair returned HTTP ${res.statusCode} for ${target.hostname}.`,
                  (res.statusCode ?? 0) >= 500,
                ),
              );
              return;
            }
            resolve(text);
          });
        },
      );

      req.on("error", (cause: Error) => {
        reject(
          new ExchangeError(
            "BETFAIR_UNREACHABLE",
            `Could not reach ${target.hostname}: ${cause.message}`,
            true,
          ),
        );
      });

      req.setTimeout(15_000, () => {
        req.destroy();
        reject(
          new ExchangeError("BETFAIR_TIMEOUT", `Betfair did not respond within 15s.`, true),
        );
      });

      req.write(body);
      req.end();
    });
  }
}
