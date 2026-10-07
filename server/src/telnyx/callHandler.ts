import crypto from "node:crypto";
import type { CallDto } from "@virtual-phone/shared";
import { getDb, mutate } from "../db/db";
import { getTelnyx, requireTelnyx } from "./client";
import { onlineForNumber } from "./credentials";
import { scheduleReconcile } from "./cost";
import { logger } from "../log/logger";
import { recordEvent } from "../events/eventStore";

export interface WebhookEnvelope {
  data?: {
    event_type?: string;
    id?: string;
    occurred_at?: string;
    payload?: Record<string, unknown>;
  };
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function sipUri(username: string): string {
  return `sip:${username}@sip.telnyx.com`;
}

function digits(value: string | null): string {
  return (value ?? "").replace(/^\+/, "");
}

/** How long an outbound call may ring before we hang it up (billing guard). */
const RING_TIMEOUT_MS = 60_000;

async function safe(fn: () => Promise<unknown>, context: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logger.warn("telnyx_command_failed", {
      context,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Hang up a leg; "call has already ended" (90018) is success, not a failure. */
async function hangupLeg(
  client: ReturnType<typeof requireTelnyx>,
  callControlId: string,
  context: string,
): Promise<void> {
  try {
    await client.calls.actions.hangup(callControlId, {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("90018") || /already ended|no longer active/i.test(message)) return;
    logger.warn("telnyx_command_failed", { context, error: message });
  }
}

export async function handleWebhookEvent(event: WebhookEnvelope): Promise<void> {
  const type = event.data?.event_type;
  const payload = event.data?.payload ?? {};
  switch (type) {
    case "call.initiated":
      await onInitiated(payload);
      break;
    case "call.answered":
      await onAnswered(payload);
      break;
    case "call.bridged":
      await onBridged(payload);
      break;
    case "call.hangup":
      await onHangup(payload);
      break;
    case "call.cost":
      await onCost(payload);
      break;
    case "call.machine.premium.detection.ended":
    case "call.machine.detection.ended":
      await onMachineDetection(type, payload);
      break;
    default:
      break;
  }
}

async function onInitiated(payload: Record<string, unknown>): Promise<void> {
  const callControlId = str(payload.call_control_id);
  if (!callControlId) return;

  const direction = str(payload.direction);
  if (direction === "outgoing") {
    await onOutboundInitiated(callControlId, payload);
    return;
  }
  if (direction !== "incoming") return;

  const client = requireTelnyx();
  const db = await getDb();
  const to = str(payload.to);
  const number = db.data.numbers.find((n) => n.phoneNumber === to);

  if (!number || !number.assignedToCallControl) {
    logger.warn("inbound_unknown_number", { to });
    await safe(
      () => client.calls.actions.reject(callControlId, { cause: "CALL_REJECTED" }),
      "reject_unknown_number",
    );
    return;
  }

  const registrations = onlineForNumber(db.data.registrations, number.id);
  const app = db.data.callControlApp;
  if (registrations.length === 0 || !app?.id) {
    logger.warn("inbound_no_browser", { to, registrations: registrations.length });
    await safe(
      () => client.calls.actions.reject(callControlId, { cause: "CALL_REJECTED" }),
      "reject_no_browser",
    );
    void recordEvent({
      source: "webhook",
      type: "inbound_rejected",
      message: `no browser registered for ${to}`,
      level: "warn",
    });
    return;
  }

  // Do NOT answer the caller's leg here. Keep it ringing until the agent's browser
  // picks up, so the PSTN side only sees "answered" when a human actually answers.
  // Answering now would report the call as picked up the instant it arrives.
  const now = new Date().toISOString();
  const call: CallDto = {
    id: crypto.randomUUID(),
    sessionId: registrations[0]!.sessionId,
    direction: "inbound",
    from: str(payload.from),
    to,
    numberId: number.id,
    phoneNumber: number.phoneNumber,
    state: "ringing",
    startedAt: now,
    answeredAt: null,
    endedAt: null,
    durationSecs: null,
    hangupCause: null,
    cost: null,
    currency: null,
    billingDurationSecs: null,
    recordingId: null,
    telnyxSessionId: str(payload.call_session_id),
    legs: [
      {
        callControlId,
        sessionId: str(payload.call_session_id),
        role: "pstn",
        state: "ringing",
      },
    ],
  };
  await mutate((data) => {
    data.calls.push(call);
  });
  logger.info("inbound_call_received", { callId: call.id, to, from: call.from });
  void recordEvent({
    source: "webhook",
    type: "inbound_call_received",
    message: `${call.from ?? "unknown"} -> ${to}`,
    callId: call.id,
  });

  for (const registration of registrations) {
    try {
      const dialed = await client.calls.dial({
        connection_id: app.id,
        from: number.phoneNumber,
        to: sipUri(registration.sipUsername),
      });
      const legId = dialed.data?.call_control_id;
      if (!legId) continue;
      await mutate((data) => {
        const row = data.calls.find((c) => c.id === call.id);
        if (row && !row.legs.some((l) => l.callControlId === legId)) {
          row.legs.push({
            callControlId: legId,
            sessionId: null,
            role: "webrtc",
            state: "ringing",
          });
        }
      });
      logger.info("inbound_dialed_browser", {
        callId: call.id,
        sipUsername: registration.sipUsername,
      });
      void recordEvent({
        source: "command",
        type: "inbound_dialed_browser",
        message: `dialed ${registration.sipUsername}`,
        callId: call.id,
      });
    } catch (error) {
      logger.warn("inbound_dial_failed", {
        callId: call.id,
        sipUsername: registration.sipUsername,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Track the PSTN leg of a browser-originated outbound call.
 *
 * The browser dials via WebRTC, so the server only learns the PSTN leg's
 * `call_control_id` from this webhook. Without it we can't hang the call up
 * when the far end rejects — the WebRTC leg then stays alive and keeps billing.
 */
async function onOutboundInitiated(
  callControlId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const sessionId = str(payload.call_session_id);
  const from = str(payload.from);
  const to = str(payload.to);
  const db = await getDb();
  const now = Date.now();
  // Concurrent calls (e.g. an on-net call in one tab and a PSTN call in
  // another) can share a number pair, so bind to the DB call whose start is
  // closest to this webhook — never just the first match.
  const call = db.data.calls
    .filter(
      (c) =>
        c.direction === "outbound" &&
        (c.state === "initiated" || c.state === "ringing" || c.state === "active") &&
        ((sessionId && c.telnyxSessionId === sessionId) ||
          (digits(c.from) === digits(from) &&
            digits(c.to) === digits(to) &&
            Math.abs(now - Date.parse(c.startedAt)) < 120_000)),
    )
    .sort(
      (a, b) => Math.abs(Date.parse(a.startedAt) - now) - Math.abs(Date.parse(b.startedAt) - now),
    )[0];
  if (!call) return;

  await mutate((data) => {
    const row = data.calls.find((c) => c.id === call.id);
    if (!row) return;
    if (!row.telnyxSessionId && sessionId) row.telnyxSessionId = sessionId;
    if (!row.legs.some((l) => l.callControlId === callControlId)) {
      row.legs.push({
        callControlId,
        sessionId: sessionId ?? null,
        role: "pstn",
        state: "ringing",
      });
    }
  });
  logger.info("outbound_pstn_leg_tracked", { callId: call.id, callControlId });
  void recordEvent({
    source: "webhook",
    type: "outbound_pstn_leg",
    message: `${call.from} -> ${call.to}`,
    callId: call.id,
  });
}

/**
 * Hang up calls that never actually connected, so a rejected or unanswered
 * call stops billing instead of leaving a leg (and its pair) connected.
 *
 * - Outbound: stale until the PSTN leg is answered.
 * - Inbound: the caller's leg rings until the agent answers, so stale until the
 *   browser leg is active.
 */
export async function enforceCallTimeouts(): Promise<number> {
  const client = getTelnyx();
  if (!client) return 0;
  const db = await getDb();
  const now = Date.now();
  const stale = db.data.calls.filter((c) => {
    if (c.state === "ended" || c.state === "failed") return false;
    if (now - Date.parse(c.startedAt) <= RING_TIMEOUT_MS) return false;
    if (c.direction === "outbound") {
      return !c.legs.some(
        (l) => l.role === "pstn" && (l.state === "active" || l.state === "answered"),
      );
    }
    return !c.legs.some((l) => l.role === "webrtc" && l.state === "active");
  });
  for (const call of stale) {
    for (const leg of call.legs) {
      await hangupLeg(client, leg.callControlId, "timeout_hangup");
    }
    await mutate((data) => {
      const row = data.calls.find((c) => c.id === call.id);
      if (!row) return;
      row.state = "failed";
      row.endedAt = new Date().toISOString();
      row.hangupCause = row.hangupCause ?? "no_answer";
    });
    void recordEvent({
      source: "system",
      type: "call_timeout",
      message: "no answer — hung up to stop billing",
      level: "warn",
      callId: call.id,
    });
  }
  if (stale.length > 0) logger.info("call_timeouts_enforced", { count: stale.length });
  return stale.length;
}

async function onAnswered(payload: Record<string, unknown>): Promise<void> {
  const callControlId = str(payload.call_control_id);
  if (!callControlId) return;
  const client = requireTelnyx();
  const db = await getDb();
  const call = db.data.calls.find((c) => c.legs.some((l) => l.callControlId === callControlId));
  if (!call) return;

  const leg = call.legs.find((l) => l.callControlId === callControlId);
  const role = leg?.role ?? "unknown";
  const now = new Date().toISOString();

  await mutate((data) => {
    const row = data.calls.find((c) => c.id === call.id);
    if (!row) return;
    const l = row.legs.find((x) => x.callControlId === callControlId);
    if (l) l.state = "active";
    if (!row.answeredAt) row.answeredAt = now;
    row.state = "active";
  });

  if (role === "webrtc") {
    // The agent picked up. Stop the other ringing browser legs, then accept the
    // caller's leg so it stops ringing. Bridging happens on the PSTN leg's own
    // `call.answered` below, so we never bridge an unanswered leg.
    for (const other of call.legs.filter(
      (l) => l.role === "webrtc" && l.callControlId !== callControlId,
    )) {
      await safe(() => client.calls.actions.hangup(other.callControlId, {}), "cancel_extra_leg");
    }
    const pstn = call.legs.find((l) => l.role === "pstn");
    if (pstn) {
      await safe(() => client.calls.actions.answer(pstn.callControlId, {}), "answer_pstn");
    }
  } else if (role === "pstn") {
    // The caller's leg is accepted now that a human answered; connect the two legs
    // (same initiator/target as before, just no longer before the agent answers).
    const webrtc = call.legs.find((l) => l.role === "webrtc" && l.state !== "ended");
    if (webrtc) {
      await safe(
        () =>
          client.calls.actions.bridge(webrtc.callControlId, {
            call_control_id_to_bridge_with: callControlId,
          }),
        "bridge_inbound",
      );
    }
  }

  void recordEvent({
    source: "webhook",
    type: "call_answered",
    message: `leg ${role} answered`,
    callId: call.id,
  });
}

async function onBridged(payload: Record<string, unknown>): Promise<void> {
  const callControlId = str(payload.call_control_id);
  if (!callControlId) return;
  const db = await getDb();
  const call = db.data.calls.find((c) => c.legs.some((l) => l.callControlId === callControlId));
  if (!call) return;
  await mutate((data) => {
    const row = data.calls.find((c) => c.id === call.id);
    if (row) row.state = "active";
  });
  void recordEvent({
    source: "webhook",
    type: "call_bridged",
    message: "legs bridged",
    callId: call.id,
  });
}

async function onHangup(payload: Record<string, unknown>): Promise<void> {
  const callControlId = str(payload.call_control_id);
  if (!callControlId) return;
  const client = requireTelnyx();
  const db = await getDb();
  const call = db.data.calls.find((c) => c.legs.some((l) => l.callControlId === callControlId));
  if (!call) return;

  const nowIso = new Date().toISOString();
  const hangupCause = str(payload.hangup_cause);
  await mutate((data) => {
    const row = data.calls.find((c) => c.id === call.id);
    if (!row) return;
    const leg = row.legs.find((l) => l.callControlId === callControlId);
    if (leg) leg.state = "ended";
    row.state = "ended";
    row.endedAt = nowIso;
    if (row.answeredAt) {
      row.durationSecs = Math.max(
        0,
        Math.round((Date.parse(nowIso) - Date.parse(row.answeredAt)) / 1000),
      );
    }
    if (hangupCause) row.hangupCause = hangupCause;
  });

  for (const other of call.legs.filter(
    (l) => l.callControlId !== callControlId && l.state !== "ended",
  )) {
    await hangupLeg(client, other.callControlId, "hangup_other_leg");
  }

  void recordEvent({
    source: "webhook",
    type: "call_hangup",
    message: hangupCause ? `hangup (${hangupCause})` : "hangup",
    callId: call.id,
  });
  // Pull the CDR cost for the call we just ended, without waiting for a click.
  scheduleReconcile(call.id);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    if (cleaned !== "" && Number.isFinite(Number(cleaned))) return Number(cleaned);
  }
  return null;
}

async function onCost(payload: Record<string, unknown>): Promise<void> {
  const callControlId = str(payload.call_control_id);
  const legId = str(payload.call_leg_id);
  const sessionId = str(payload.call_session_id);
  if (!callControlId && !legId && !sessionId) return;

  const db = await getDb();
  const call =
    (callControlId &&
      db.data.calls.find((c) => c.legs.some((l) => l.callControlId === callControlId))) ||
    (legId && db.data.calls.find((c) => c.legs.some((l) => l.telnyxLegId === legId))) ||
    (sessionId &&
      db.data.calls.find(
        (c) => c.telnyxSessionId === sessionId || c.legs.some((l) => l.sessionId === sessionId),
      )) ||
    undefined;
  if (!call) return;

  const totalCost = num(payload.total_cost);
  const billed = num(payload.billed_duration_secs);
  const parts = Array.isArray(payload.cost_parts) ? payload.cost_parts : [];
  const currency =
    parts
      .map((p) =>
        p && typeof p === "object" ? str((p as Record<string, unknown>).currency) : null,
      )
      .find((c) => c) ?? null;

  await mutate((data) => {
    const row = data.calls.find((c) => c.id === call.id);
    if (!row) return;
    if (!row.telnyxSessionId && sessionId) row.telnyxSessionId = sessionId;

    // Attach to the leg we know; otherwise this is a leg we never tracked
    // (e.g. the PSTN leg of a browser-originated outbound call) — record it so
    // the call total includes its cost instead of silently dropping it.
    let leg =
      (callControlId && row.legs.find((l) => l.callControlId === callControlId)) ||
      (legId && row.legs.find((l) => l.telnyxLegId === legId)) ||
      undefined;
    if (!leg) {
      leg = {
        callControlId: callControlId ?? legId ?? `cost:${sessionId ?? crypto.randomUUID()}`,
        sessionId: sessionId ?? null,
        telnyxLegId: legId ?? null,
        role: "pstn",
        state: "ended",
      };
      row.legs.push(leg);
    }
    if (totalCost !== null) leg.cost = totalCost;
    if (billed !== null) leg.billedDurationSecs = billed;
    if (currency) leg.currency = currency;

    // A call's cost is the sum of its legs (PSTN + WebRTC).
    const legCosts = row.legs.map((l) => l.cost).filter((c): c is number => typeof c === "number");
    if (legCosts.length > 0) row.cost = Number(legCosts.reduce((s, c) => s + c, 0).toFixed(6));
    const legBilled = row.legs
      .map((l) => l.billedDurationSecs)
      .filter((b): b is number => typeof b === "number");
    if (legBilled.length > 0) row.billingDurationSecs = legBilled.reduce((s, b) => s + b, 0);
    if (currency) row.currency = currency;
  });
  void recordEvent({
    source: "webhook",
    type: "call_cost",
    message: `leg cost ${payload.total_cost ?? "?"}`,
    callId: call.id,
  });
}

async function onMachineDetection(type: string, payload: Record<string, unknown>): Promise<void> {
  const callControlId = str(payload.call_control_id);
  if (!callControlId) return;
  const db = await getDb();
  const call = db.data.calls.find((c) => c.legs.some((l) => l.callControlId === callControlId));
  void recordEvent({
    source: "webhook",
    type,
    message: `AMD result: ${str(payload.result) ?? "unknown"}`,
    callId: call?.id ?? null,
  });
}
