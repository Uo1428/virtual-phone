import { z } from "zod";

const boolFromString = (def = false) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === "true"));

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  TELNYX_API_KEY: z.string().min(1).optional(),
  TELNYX_PUBLIC_KEY: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(16).optional(),
  APP_PASSCODE: z.string().optional(),
  DATA_DIR: z.string().default("server/data"),
  TELNYX_CALL_CONTROL_APP_ID: z.string().optional(),
  TELNYX_CREDENTIAL_CONNECTION_ID: z.string().optional(),
  TELNYX_OUTBOUND_VOICE_PROFILE_ID: z.string().optional(),
  TELNYX_CALL_CONTROL_APP_NAME: z.string().default("virtual-phone"),
  TELNYX_CREDENTIAL_CONNECTION_NAME: z.string().default("virtual-phone-webrtc"),
  TELNYX_OUTBOUND_PROFILE_NAME: z.string().default("virtual-phone-outbound"),
  TELNYX_PROVISION: boolFromString(true),
  /** Opt out of webhook signature verification (e.g. a proxy already verifies). */
  TELNYX_ALLOW_UNVERIFIED_WEBHOOKS: boolFromString(false),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "invalid_env",
      issues: parsed.error.issues,
    }),
  );
  process.exit(1);
}

export const env = parsed.data;

const REQUIRED_IN_PRODUCTION = [
  "TELNYX_API_KEY",
  "TELNYX_PUBLIC_KEY",
  "SESSION_SECRET",
  "PUBLIC_URL",
] as const;

export const isProduction = env.NODE_ENV === "production";

/** Missing required vars are fatal in production, warnings otherwise. */
export function assertProductionEnv(): string[] {
  const missing: string[] = REQUIRED_IN_PRODUCTION.filter(
    (key) => !env[key] || (typeof env[key] === "string" && env[key].length === 0),
  );
  for (const key of missing) {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level: isProduction ? "error" : "warn",
      msg: "missing_env",
      key,
      note: "set this before using Telnyx features",
    });
    if (isProduction) console.error(entry);
    else console.warn(entry);
  }
  return missing;
}

/** True when incoming webhooks can be cryptographically verified. */
export function canVerifyWebhooks(): boolean {
  return Boolean(env.TELNYX_PUBLIC_KEY);
}

/** Whether unverified webhooks may be accepted (never in production unless opted in). */
export function allowUnverifiedWebhooks(): boolean {
  if (env.TELNYX_ALLOW_UNVERIFIED_WEBHOOKS) return true;
  return !isProduction;
}
