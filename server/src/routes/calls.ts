import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { CallDto, CallTimelineDto } from "@virtual-phone/shared";
import { requireSession } from "../auth/session";
import { getDb, mutate } from "../db/db";
import { logger } from "../log/logger";
import { recordEvent } from "../events/eventStore";
import { getTelnyx } from "../telnyx/client";
import { scheduleReconcile } from "../telnyx/cost";

export const callsRouter = Router();

callsRouter.use(requireSession);

const E164 = /^\+[1-9]\d{6,14}$/;

/** Digits-only view of a phone number, for tolerant equality checks. */
function sameDigits(value: string): string {
  return value.replace(/\D/g, "");
}

const StartOutboundBody = z.object({
  numberId: z.string().min(1),
  destination: z.string().regex(E164, "Destination must be E.164, e.g. +15551234567"),
});

callsRouter.post("/calls/outbound", async (req, res) => {
  const parsed = StartOutboundBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: { code: "bad_request", message: parsed.error.issues[0]?.message ?? "Invalid body" },
    });
    return;
  }
  const db = await getDb();
  const number = db.data.numbers.find((n) => n.id === parsed.data.numberId);
  if (!number) {
    res.status(400).json({ error: { code: "unknown_number", message: "Unknown number" } });
    return;
  }

  // Guard: dialing the number this tab is registered as would call ourselves.
  if (sameDigits(parsed.data.destination) === sameDigits(number.phoneNumber)) {
    res.status(400).json({
      error: {
        code: "self_call",
        message: "You can't call the number this tab is connected as. Pick a different destination.",
      },
    });
    return;
  }

  const now = new Date().toISOString();
  const call: CallDto = {
    id: crypto.randomUUID(),
    sessionId: req.sessionId!,
    direction: "outbound",
    from: number.phoneNumber,
    to: parsed.data.destination,
    numberId: number.id,
    phoneNumber: number.phoneNumber,
    state: "initiated",
    startedAt: now,
    answeredAt: null,
    endedAt: null,
    durationSecs: null,
    hangupCause: null,
    cost: null,
    currency: null,
    billingDurationSecs: null,
    recordingId: null,
    telnyxSessionId: null,
    legs: [],
  };
  await mutate((data) => {
    data.calls.push(call);
  });
  logger.info("outbound_call_started", { callId: call.id, to: call.to, from: call.from });
  void recordEvent({
    source: "client",
    type: "outbound_call_started",
    message: `${call.from} -> ${call.to}`,
    callId: call.id,
  });
  res.json(call);
});

const StatusBody = z.object({
  state: z.enum(["initiated", "ringing", "active", "ended", "failed"]),
  telnyxSessionId: z.string().nullable().optional(),
  telnyxCallControlId: z.string().nullable().optional(),
  telnyxLegId: z.string().nullable().optional(),
  hangupCause: z.string().nullable().optional(),
});

callsRouter.post("/calls/:id/status", async (req, res) => {
  const parsed = StatusBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: "bad_request", message: "Invalid status body" } });
    return;
  }
  const db = await getDb();
  const existing = db.data.calls.find((c) => c.id === req.params.id);
  if (!existing || existing.sessionId !== req.sessionId) {
    res.status(404).json({ error: { code: "not_found", message: "Call not found" } });
    return;
  }
  const previousState = existing.state;

  const nowIso = new Date().toISOString();
  await mutate((data) => {
    const call = data.calls.find((c) => c.id === req.params.id);
    if (!call) return;
    call.state = parsed.data.state;
    if (parsed.data.telnyxSessionId) call.telnyxSessionId = parsed.data.telnyxSessionId;
    if (parsed.data.telnyxCallControlId) {
      const legId = parsed.data.telnyxCallControlId;
      let leg = call.legs.find((l) => l.callControlId === legId);
      if (!leg) {
        leg = {
          callControlId: legId,
          sessionId: parsed.data.telnyxSessionId ?? null,
          telnyxLegId: parsed.data.telnyxLegId ?? null,
          role: "webrtc",
          state: parsed.data.state,
        };
        call.legs.push(leg);
      } else {
        if (parsed.data.telnyxSessionId) leg.sessionId = parsed.data.telnyxSessionId;
        if (parsed.data.telnyxLegId) leg.telnyxLegId = parsed.data.telnyxLegId;
        leg.state = parsed.data.state;
      }
    }
    if (parsed.data.state === "active" && !call.answeredAt) call.answeredAt = nowIso;
    if (parsed.data.state === "ended" || parsed.data.state === "failed") {
      call.endedAt = nowIso;
      if (call.answeredAt) {
        call.durationSecs = Math.max(
          0,
          Math.round((Date.parse(nowIso) - Date.parse(call.answeredAt)) / 1000),
        );
      }
      if (parsed.data.hangupCause) call.hangupCause = parsed.data.hangupCause;
    }
  });
  if (previousState !== parsed.data.state) {
    void recordEvent({
      source: "client",
      type: `call_${parsed.data.state}`,
      message: `client reported ${parsed.data.state}`,
      callId: existing.id,
    });
  }

  // The browser leg ending does not tear down the PSTN leg — hang up every
  // still-live leg so an outbound call stops billing the moment the agent (or
  // a closed tab) ends it.
  if (parsed.data.state === "ended" || parsed.data.state === "failed") {
    const client = getTelnyx();
    if (client) {
      for (const leg of existing.legs) {
        if (leg.state === "ended") continue;
        try {
          await client.calls.actions.hangup(leg.callControlId, {});
          leg.state = "ended";
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // 90018 = call already ended; expected when the far end hung up first.
          if (!(message.includes("90018") || /already ended|no longer active/i.test(message))) {
            logger.warn("leg_hangup_failed", {
              callId: existing.id,
              leg: leg.callControlId,
              error: message,
            });
          }
        }
      }
    }
    // Reconcile this call's cost automatically once the CDR lands.
    scheduleReconcile(existing.id);
  }

  res.json({ ok: true });
});

callsRouter.get("/calls", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const db = await getDb();
  const calls = db.data.calls
    .filter((c) => c.sessionId === req.sessionId)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, limit);
  res.json({ calls });
});

callsRouter.get("/calls/:id", async (req, res) => {
  const db = await getDb();
  const call = db.data.calls.find((c) => c.id === req.params.id);
  if (!call || call.sessionId !== req.sessionId) {
    res.status(404).json({ error: { code: "not_found", message: "Call not found" } });
    return;
  }
  res.json(call);
});

/** Per-call recorder log: every event with offsets from call start. */
callsRouter.get("/calls/:id/timeline", async (req, res) => {
  const db = await getDb();
  const call = db.data.calls.find((c) => c.id === req.params.id);
  if (!call || call.sessionId !== req.sessionId) {
    res.status(404).json({ error: { code: "not_found", message: "Call not found" } });
    return;
  }
  const start = Date.parse(call.startedAt);
  const raw = db.data.events
    .filter((e) => e.callId === call.id)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  let previous = start;
  const entries = raw.map((e) => {
    const at = Date.parse(e.at);
    const entry = {
      id: e.id,
      at: e.at,
      offsetMs: at - start,
      deltaMs: at - previous,
      source: e.source,
      level: e.level,
      type: e.type,
      message: e.message,
    };
    previous = at;
    return entry;
  });

  const dto: CallTimelineDto = { call, entries };
  res.json(dto);
});
