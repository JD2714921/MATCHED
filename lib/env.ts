import { z } from "zod";

/**
 * Central, validated view of process configuration.
 *
 * Deliberately tolerant at import time: the app must boot in environments where
 * neither an exchange nor an AI provider is configured, because both have
 * offline defaults. What is NOT tolerated is a half-configured live provider —
 * that is checked when the provider is actually constructed.
 */

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  APP_SECRET: z.string().default("development-only-secret"),

  EXCHANGE_PROVIDER: z.enum(["fixture", "betfair"]).default("fixture"),
  BETFAIR_APP_KEY: z.string().optional(),
  BETFAIR_USERNAME: z.string().optional(),
  BETFAIR_PASSWORD: z.string().optional(),
  BETFAIR_CERT_PATH: z.string().optional(),
  BETFAIR_KEY_PATH: z.string().optional(),
  BETFAIR_KEY_IS_DELAYED: z
    .string()
    .optional()
    .transform((v) => v !== "false"),

  AI_PROVIDER: z.enum(["stub", "anthropic"]).default("stub"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),

  E2E: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export const env: Env = load();

export const isTest = env.NODE_ENV === "test" || env.E2E === "1";
export const isProduction = env.NODE_ENV === "production";
