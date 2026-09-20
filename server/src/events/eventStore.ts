import crypto from "node:crypto";
import type { CallEventDto, EventLevel, EventSource } from "@virtual-phone/shared";
import { mutate } from "../db/db";
import type { LogEntry } from "../log/logger";
import { broadcast } from "./bus";

const MAX_EVENTS = 5000;

function mapLevel(level: LogEntry["level"]): EventLevel {
  return level;
}

/**
 * Persist a structured event to the JSON DB for the history/logs UI.
 * Fire-and-forget: callers must not await request paths on this.
 */
export async function recordEvent(input: {
  source: EventSource;
  type: string;
  message: string;
  callId?: string | null;
  level?: EventLevel;
  raw?: unknown;
}): Promise<CallEventDto> {
  const event: CallEventDto = {
    id: crypto.randomUUID(),
    callId: input.callId ?? null,
    at: new Date().toISOString(),
    source: input.source,
    level: input.level ?? "info",
    type: input.type,
    message: input.message,
    ...(input.raw === undefined ? {} : { raw: input.raw }),
  };
  await mutate((data) => {
    data.events.push(event);
    if (data.events.length > MAX_EVENTS) {
      data.events.splice(0, data.events.length - MAX_EVENTS);
    }
  });
  broadcast(event);
  return event;
}

/** Sink that mirrors structured logs into the events collection. */
export function logSink(entry: LogEntry): void {
  // Debug lines are high-volume (one per webhook); keep them out of the DB.
  if (entry.level === "debug") return;
  void recordEvent({
    source: "system",
    type: entry.msg,
    message: entry.msg,
    level: mapLevel(entry.level),
    raw: entry.fields,
  });
}
