import pino from "pino";
import { env } from "./env";

/**
 * Structured logging.
 *
 * `redact` is not cosmetic here: the Betfair client handles a password and a
 * session token, and neither should ever reach a log sink.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "password",
      "*.password",
      "sessionToken",
      "*.sessionToken",
      "appKey",
      "*.appKey",
      "X-Authentication",
      "headers.X-Authentication",
      "apiKey",
      "*.apiKey",
    ],
    censor: "[redacted]",
  },
  base: undefined,
});

export function childLogger(name: string) {
  return logger.child({ module: name });
}
