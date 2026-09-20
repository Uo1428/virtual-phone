import { Router } from "express";
import express from "express";
import { allowUnverifiedWebhooks, canVerifyWebhooks } from "../env";
import { getTelnyx } from "../telnyx/client";
import { logger } from "../log/logger";
import { recordEvent } from "../events/eventStore";
import { handleWebhookEvent } from "../telnyx/callHandler";

export const telnyxRouter = Router();

/** Log the unverified-webhook warning once, not per event. */
let warnedUnverified = false;

function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.join(",");
  }
  return out;
}

/**
 * Telnyx webhook receiver. Uses a raw body because signature verification
 * (`client.webhooks.unwrap`) requires the exact bytes - see telnyx@7 README.
 */
telnyxRouter.post("/webhooks", express.raw({ type: "*/*" }), async (req, res) => {
  const client = getTelnyx();
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";

  let event: Awaited<ReturnType<NonNullable<typeof client>["webhooks"]["unwrap"]>> | null = null;

  if (client && canVerifyWebhooks()) {
    try {
      event = await client.webhooks.unwrap(raw, { headers: normalizeHeaders(req.headers) });
    } catch (error) {
      logger.warn("webhook_invalid", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(401).json({ error: { code: "invalid_signature", message: "Invalid signature" } });
      return;
    }
  } else if (!allowUnverifiedWebhooks()) {
    // Production without a public key: refusing is safer than trusting anyone.
    if (!warnedUnverified) {
      warnedUnverified = true;
      logger.error("webhook_verification_disabled", {
        reason: "TELNYX_PUBLIC_KEY not set",
        note: "set TELNYX_PUBLIC_KEY, or TELNYX_ALLOW_UNVERIFIED_WEBHOOKS=true to opt in",
      });
    }
    res.status(401).json({
      error: {
        code: "webhook_unverified",
        message: "Webhook signature verification is not configured",
      },
    });
    return;
  } else {
    if (!warnedUnverified) {
      warnedUnverified = true;
      logger.warn("webhook_unverified", { reason: "missing_key_or_public_key" });
    }
    try {
      event = JSON.parse(raw) as typeof event;
    } catch {
      res.status(400).json({ error: { code: "bad_request", message: "Invalid JSON" } });
      return;
    }
  }

  const eventType =
    (event as { data?: { event_type?: string } } | null)?.data?.event_type ?? "unknown";
  logger.info("webhook_received", { eventType });
  void recordEvent({
    source: "webhook",
    type: eventType,
    message: `webhook ${eventType}`,
    level: "debug",
  });

  try {
    await handleWebhookEvent(event as Parameters<typeof handleWebhookEvent>[0]);
  } catch (error) {
    logger.error("webhook_handler_failed", {
      eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  res.status(200).json({ ok: true });
});
