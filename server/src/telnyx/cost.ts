import type { CallDto } from "@virtual-phone/shared";
import { getDb, mutate } from "../db/db";
import { requireTelnyx } from "./client";
import { logger } from "../log/logger";
import { recordEvent } from "../events/eventStore";

type Cdr = Record<string, unknown>;

const VOICE_RECORD_TYPES = ["webrtc", "call-control", "sip-trunking"] as const;

/** Tight window for legacy calls that have no Telnyx ids at all. */
const FALLBACK_WINDOW_MS = 20_000;
/** Wider window for grouping CDRs by session when ids were never captured. */
const SESSION_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface CdrTotals {
  cost: number | null;
  currency: string | null;
  billedSecs: number | null;
  callSecs: number | null;
  cdrIds: string[];
  /** `call_session_id` of the matched records, so it can be stored for next time. */
  sessionId: string | null;
  /** The matched records, so each leg can be costed exactly. */
  matched: Cdr[];
}

const EMPTY: CdrTotals = {
  cost: null,
  currency: null,
  billedSecs: null,
  callSecs: null,
  cdrIds: [],
  sessionId: null,
  matched: [],
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    if (cleaned !== "" && Number.isFinite(Number(cleaned))) return Number(cleaned);
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function cdrKey(cdr: Cdr): string {
  return asString(cdr.id) ?? JSON.stringify(cdr).slice(0, 64);
}

function cdrIdentifiers(cdr: Cdr): Set<string> {
  const ids = new Set<string>();
  for (const key of [
    "telnyx_session_id",
    "call_session_id",
    "session_id",
    "telnyx_call_control_id",
    "call_control_id",
    "telnyx_leg_id",
    "call_leg_id",
  ]) {
    const value = asString(cdr[key]);
    if (value) ids.add(value);
  }
  return ids;
}

function callIdentifiers(call: CallDto): Set<string> {
  const ids = new Set<string>();
  if (call.telnyxSessionId) ids.add(call.telnyxSessionId);
  for (const leg of call.legs) {
    ids.add(leg.callControlId);
    if (leg.sessionId) ids.add(leg.sessionId);
    if (leg.telnyxLegId) ids.add(leg.telnyxLegId);
  }
  return ids;
}

function digits(value: string | null): string {
  return (value ?? "").replace(/^\+/, "");
}

function cdrStart(cdr: Cdr): number | null {
  const raw = asString(cdr.started_at) ?? asString(cdr.date_time) ?? asString(cdr.date);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Same caller/callee (either side may be absent on a CDR). Direction is only
 * checked when requested — a browser leg's CDR can report the opposite
 * direction from the call as the app sees it.
 */
function sameParties(call: CallDto, cdr: Cdr, requireDirection = true): boolean {
  if (requireDirection) {
    const direction = asString(cdr.direction);
    if (direction && direction !== call.direction) return false;
  }

  const cli = asString(cdr.cli) ?? asString(cdr.caller_number);
  const cld = asString(cdr.cld) ?? asString(cdr.dest_number);
  if (!cli && !cld) return false;
  if (cli && digits(cli) !== digits(call.from)) return false;
  if (cld && digits(cld) !== digits(call.to)) return false;
  return true;
}

/** Last-resort match for legacy calls with no ids: parties + tight time window. */
function matchesByFallback(call: CallDto, cdr: Cdr): boolean {
  if (!sameParties(call, cdr)) return false;
  const started = cdrStart(cdr);
  if (started === null) return false;
  return Math.abs(started - Date.parse(call.startedAt)) <= FALLBACK_WINDOW_MS;
}

function aggregate(
  records: Cdr[],
): Omit<CdrTotals, "cdrIds" | "sessionId" | "matched"> & { ids: string[] } {
  let cost = 0;
  let currency: string | null = null;
  let billedSecs = 0;
  let callSecs = 0;
  const ids: string[] = [];
  for (const cdr of records) {
    ids.push(cdrKey(cdr));
    cost += asNumber(cdr.cost ?? cdr.total_cost) ?? 0;
    currency = currency ?? asString(cdr.currency);
    billedSecs += asNumber(cdr.billed_sec ?? cdr.billed_duration_secs) ?? 0;
    callSecs = Math.max(callSecs, asNumber(cdr.call_sec) ?? 0);
  }
  return { cost: Number(cost.toFixed(6)), currency, billedSecs, callSecs, ids };
}

function toTotals(records: Cdr[]): CdrTotals {
  const agg = aggregate(records);
  const sessionId =
    records.map((r) => asString(r.call_session_id)).find((s) => s !== null) ?? null;
  return { ...agg, cdrIds: agg.ids, sessionId, matched: records };
}

async function fetchVoiceCdrs(): Promise<Cdr[]> {
  const client = requireTelnyx();
  const records: Cdr[] = [];
  for (const recordType of VOICE_RECORD_TYPES) {
    try {
      const page = client.detailRecords.list({
        filter: { record_type: recordType, date_range: "today" },
      });
      for await (const record of page) {
        records.push(record as unknown as Cdr);
      }
    } catch (error) {
      logger.warn("cdr_fetch_failed", {
        recordType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return records;
}

/**
 * Sum every distinct CDR that belongs to this call (all legs).
 *
 * - `cost` and `billedSecs` are summed: every leg is billed independently.
 * - `callSecs` is the MAX leg duration, not the sum — bridged legs run
 *   concurrently, so summing them would double the talk time.
 * - `consumed` (optional) prevents the same CDR being attributed to two calls
 *   during a batch reconcile.
 */
export function sumMatchingCdrs(
  call: CallDto,
  records: Cdr[],
  consumed?: Set<string>,
): CdrTotals {
  const wanted = callIdentifiers(call);
  const seen = new Set<string>();
  const matched: Cdr[] = [];

  for (const cdr of records) {
    const key = cdrKey(cdr);
    if (seen.has(key) || consumed?.has(key)) continue;

    let match = false;
    for (const value of cdrIdentifiers(cdr)) {
      if (wanted.has(value)) {
        match = true;
        break;
      }
    }
    if (!match && wanted.size === 0) match = matchesByFallback(call, cdr);
    if (!match) continue;

    seen.add(key);
    consumed?.add(key);
    matched.push(cdr);
  }

  return matched.length > 0 ? toTotals(matched) : EMPTY;
}

/**
 * Fallback for calls whose Telnyx ids were never captured (browser-originated
 * outbound calls): group CDRs by call session, then take the group whose start
 * is closest to the call's own start. `consumed` keeps each session to one call.
 */
function matchBySession(call: CallDto, records: Cdr[], consumed?: Set<string>): CdrTotals {
  const groups = new Map<string, Cdr[]>();
  for (const cdr of records) {
    const key = cdrKey(cdr);
    if (consumed?.has(key) || !sameParties(call, cdr, false)) continue;
    const group = asString(cdr.call_session_id) ?? asString(cdr.call_leg_id) ?? key;
    const bucket = groups.get(group) ?? [];
    bucket.push(cdr);
    groups.set(group, bucket);
  }
  if (groups.size === 0) return EMPTY;

  const target = Date.parse(call.startedAt);
  let best: Cdr[] | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const bucket of groups.values()) {
    const starts = bucket.map(cdrStart).filter((s): s is number => s !== null);
    const diff =
      starts.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.abs(Math.min(...starts) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = bucket;
    }
  }
  if (!best || bestDiff > SESSION_WINDOW_MS) return EMPTY;

  for (const cdr of best) consumed?.add(cdrKey(cdr));
  return toTotals(best);
}

/** Match by ids first; fall back to session grouping when the call has none. */
export function matchCallCdrs(call: CallDto, records: Cdr[], consumed?: Set<string>): CdrTotals {
  const byId = sumMatchingCdrs(call, records, consumed);
  if (byId.cost !== null) return byId;
  if (callIdentifiers(call).size > 0) return byId;
  return matchBySession(call, records, consumed);
}

type ApplyMode = "always" | "increase";

/** Cost each leg from its own CDR so the breakdown mirrors Telnyx. */
function assignLegCosts(call: CallDto, records: Cdr[]): void {
  for (const cdr of records) {
    const ids = cdrIdentifiers(cdr);
    let leg = call.legs.find(
      (l) => ids.has(l.callControlId) || (l.telnyxLegId ? ids.has(l.telnyxLegId) : false),
    );
    if (!leg) {
      leg = {
        callControlId:
          asString(cdr.call_control_id) ?? asString(cdr.call_leg_id) ?? `cdr:${cdrKey(cdr)}`,
        sessionId: asString(cdr.call_session_id),
        telnyxLegId: asString(cdr.call_leg_id),
        role: "pstn",
        state: "ended",
      };
      call.legs.push(leg);
    }
    const cost = asNumber(cdr.cost ?? cdr.total_cost);
    const billed = asNumber(cdr.billed_sec ?? cdr.billed_duration_secs);
    const currency = asString(cdr.currency);
    if (cost !== null) leg.cost = cost;
    if (billed !== null) leg.billedDurationSecs = billed;
    if (currency) leg.currency = currency;
  }
}

/**
 * Write CDR totals (and per-leg costs) onto a call.
 *
 * `increase` refuses to lower a value, so a CDR that has not landed yet can't
 * regress an already-reconciled call. `always` is for the manual reconcile.
 */
function applyTotals(call: CallDto, totals: CdrTotals, mode: ApplyMode): boolean {
  if (totals.cost === null) return false;
  if (mode === "increase" && call.cost !== null && totals.cost < call.cost) return false;

  assignLegCosts(call, totals.matched);

  const nextBilled = totals.billedSecs ?? 0;
  const nextDuration = Math.max(call.durationSecs ?? 0, totals.callSecs ?? 0);
  const learnedSession = !call.telnyxSessionId && totals.sessionId !== null;

  const changed =
    totals.cost !== call.cost ||
    nextBilled !== (call.billingDurationSecs ?? 0) ||
    nextDuration !== (call.durationSecs ?? 0) ||
    (totals.currency !== null && totals.currency !== call.currency) ||
    learnedSession;

  call.cost = totals.cost;
  call.currency = totals.currency ?? call.currency;
  call.billingDurationSecs = nextBilled || null;
  call.durationSecs = nextDuration || null;
  if (learnedSession) call.telnyxSessionId = totals.sessionId;
  return changed;
}

function persist(callId: string, call: CallDto): Promise<void> {
  return mutate((data) => {
    const row = data.calls.find((c) => c.id === callId);
    if (!row) return;
    row.cost = call.cost;
    row.currency = call.currency;
    row.billingDurationSecs = call.billingDurationSecs;
    row.durationSecs = call.durationSecs;
    row.telnyxSessionId = call.telnyxSessionId;
    row.legs = call.legs;
  });
}

async function reconcileCallWithMode(callId: string, mode: ApplyMode): Promise<boolean> {
  const db = await getDb();
  const call = db.data.calls.find((c) => c.id === callId);
  if (!call) return false;

  const records = await fetchVoiceCdrs();
  const totals = matchCallCdrs(call, records);
  if (totals.cost === null) return false;

  const changed = applyTotals(call, totals, mode);
  await persist(callId, call);
  if (changed) {
    void recordEvent({
      source: "system",
      type: "cost_reconciled",
      message: `cost ${call.cost ?? "?"} ${call.currency ?? ""}`.trim(),
      callId,
    });
  }
  return changed;
}

/** Manual reconcile (button): applies whatever CDRs are available right now. */
export function reconcileCall(callId: string): Promise<boolean> {
  return reconcileCallWithMode(callId, "always");
}

/** CDRs lag behind the call, so retry a few times before giving up. */
const RECONCILE_RETRY_MS = [5_000, 20_000, 60_000, 180_000];
const scheduled = new Set<string>();

/**
 * Reconcile a single call once it ends — not the whole table. Retries with
 * backoff because Telnyx detail records take a while to appear. Calls already
 * scheduled are ignored, so two tabs hanging up together stay independent.
 */
export function scheduleReconcile(callId: string): void {
  if (scheduled.has(callId)) return;
  scheduled.add(callId);

  const attempt = (n: number) => {
    if (n >= RECONCILE_RETRY_MS.length) {
      scheduled.delete(callId);
      return;
    }
    const timer = setTimeout(() => {
      void reconcileCallWithMode(callId, "increase")
        .then((done) => {
          if (done) scheduled.delete(callId);
          else attempt(n + 1);
        })
        .catch(() => scheduled.delete(callId));
    }, RECONCILE_RETRY_MS[n]!);
    timer.unref?.();
  };

  attempt(0);
}
