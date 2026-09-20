import { z } from "zod";

/** A phone number owned by the Telnyx account. */
export const NumberDto = z.object({
  id: z.string(),
  phoneNumber: z.string(),
  connectionId: z.string().nullable(),
  connectionName: z.string().nullable(),
  status: z.string().nullable(),
  assignedToCallControl: z.boolean(),
  assignmentStatus: z.enum(["assigned", "needs_manual", "unknown"]),
  supportsInbound: z.boolean(),
});
export type NumberDto = z.infer<typeof NumberDto>;

/** Who currently holds a number's WebRTC registration. */
export const NumberOccupancyDto = z.object({
  numberId: z.string(),
  tabId: z.string(),
  sessionId: z.string(),
  /** Human-readable holder, e.g. "Chrome · Windows". */
  device: z.string().nullable(),
  online: z.boolean(),
  since: z.string(),
});
export type NumberOccupancyDto = z.infer<typeof NumberOccupancyDto>;

export const NumbersResponseDto = z.object({
  numbers: z.array(NumberDto),
  occupancy: z.record(z.string(), NumberOccupancyDto.nullable()),
});
export type NumbersResponseDto = z.infer<typeof NumbersResponseDto>;

/** One leg of a call (PSTN side or browser/WebRTC side). */
export const CallLegDto = z.object({
  callControlId: z.string(),
  sessionId: z.string().nullable(),
  /** Telnyx call-leg UUID (`call_leg_id`) — the CDR's primary leg identifier. */
  telnyxLegId: z.string().nullable().optional(),
  role: z.enum(["pstn", "webrtc"]),
  state: z.string(),
  cost: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  billedDurationSecs: z.number().nullable().optional(),
});
export type CallLegDto = z.infer<typeof CallLegDto>;

export const CallDirection = z.enum(["inbound", "outbound"]);
export type CallDirection = z.infer<typeof CallDirection>;

export const CallState = z.enum([
  "initiated",
  "ringing",
  "active",
  "ended",
  "failed",
]);
export type CallState = z.infer<typeof CallState>;

/** A call with its legs and reconciled cost/duration. */
export const CallDto = z.object({
  id: z.string(),
  sessionId: z.string().nullable(),
  direction: CallDirection,
  from: z.string().nullable(),
  to: z.string().nullable(),
  numberId: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  state: CallState,
  startedAt: z.string(),
  answeredAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSecs: z.number().nullable(),
  hangupCause: z.string().nullable(),
  cost: z.number().nullable(),
  currency: z.string().nullable(),
  billingDurationSecs: z.number().nullable(),
  recordingId: z.string().nullable(),
  telnyxSessionId: z.string().nullable(),
  legs: z.array(CallLegDto).default([]),
});
export type CallDto = z.infer<typeof CallDto>;

export const EventSource = z.enum(["webhook", "command", "client", "system"]);
export type EventSource = z.infer<typeof EventSource>;

export const EventLevel = z.enum(["debug", "info", "warn", "error"]);
export type EventLevel = z.infer<typeof EventLevel>;

/** A structured log/history event. */
export const CallEventDto = z.object({
  id: z.string(),
  callId: z.string().nullable(),
  at: z.string(),
  source: EventSource,
  level: EventLevel,
  type: z.string(),
  message: z.string(),
  raw: z.unknown().optional(),
});
export type CallEventDto = z.infer<typeof CallEventDto>;

export const SessionDto = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type SessionDto = z.infer<typeof SessionDto>;

/** Response of POST /api/webrtc/token. Never contains the API key or SIP password. */
export const TokenResponseDto = z.object({
  loginToken: z.string(),
  sipUsername: z.string(),
  numberId: z.string(),
  phoneNumber: z.string(),
  expiresInSecs: z.number(),
});
export type TokenResponseDto = z.infer<typeof TokenResponseDto>;

export const CostSummaryDto = z.object({
  range: z.enum(["today", "7d", "30d", "all"]),
  totalCost: z.number(),
  currency: z.string().nullable(),
  callCount: z.number(),
  totalDurationSecs: z.number(),
});
export type CostSummaryDto = z.infer<typeof CostSummaryDto>;

export const ApiErrorDto = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiErrorDto = z.infer<typeof ApiErrorDto>;

export const HealthDto = z.object({
  ok: z.boolean(),
  uptime: z.number(),
  version: z.string(),
});
export type HealthDto = z.infer<typeof HealthDto>;

export const OverviewDto = z.object({
  numbers: z.array(NumberDto),
  occupancy: z.record(z.string(), NumberOccupancyDto.nullable()),
  discovery: z.object({
    callControlApp: z.unknown().nullable(),
    credentialConnection: z.unknown().nullable(),
    lastDiscoveryAt: z.string().nullable(),
  }),
  cost: CostSummaryDto,
  recentCalls: z.array(CallDto),
  recentEvents: z.array(CallEventDto),
});
export type OverviewDto = z.infer<typeof OverviewDto>;

/** One row of a call's recorder log, with offsets from call start. */
export const CallTimelineEntryDto = z.object({
  id: z.string(),
  at: z.string(),
  offsetMs: z.number(),
  deltaMs: z.number(),
  source: EventSource,
  level: EventLevel,
  type: z.string(),
  message: z.string(),
});
export type CallTimelineEntryDto = z.infer<typeof CallTimelineEntryDto>;

export const CallTimelineDto = z.object({
  call: CallDto,
  entries: z.array(CallTimelineEntryDto),
});
export type CallTimelineDto = z.infer<typeof CallTimelineDto>;
