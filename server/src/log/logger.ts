type Level = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface LogEntry {
  ts: string;
  level: Level;
  msg: string;
  fields: LogFields;
}

type Sink = (entry: LogEntry) => void;

const sinks: Sink[] = [];

/** Register a sink (e.g. persist events to the JSON DB). */
export function onLog(sink: Sink): void {
  sinks.push(sink);
}

function emit(level: Level, msg: string, fields: LogFields = {}): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg, fields };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
  for (const sink of sinks) {
    try {
      sink(entry);
    } catch {
      // never let a logging sink break the request path
    }
  }
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};
