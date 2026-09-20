import { describe, expect, test } from "bun:test";
import type { CallDto } from "@virtual-phone/shared";
import { matchCallCdrs, sumMatchingCdrs } from "./cost";

function makeCall(overrides: Partial<CallDto> = {}): CallDto {
  return {
    id: "call1",
    sessionId: "sess1",
    direction: "inbound",
    from: "+15550000001",
    to: "+15550000002",
    numberId: "n1",
    phoneNumber: "+15550000002",
    state: "ended",
    startedAt: new Date().toISOString(),
    answeredAt: null,
    endedAt: null,
    durationSecs: null,
    hangupCause: null,
    cost: null,
    currency: null,
    billingDurationSecs: null,
    recordingId: null,
    telnyxSessionId: "sess-abc",
    legs: [
      { callControlId: "cc-pstn", sessionId: "sess-abc", role: "pstn", state: "ended" },
      { callControlId: "cc-webrtc", sessionId: "sess-abc", role: "webrtc", state: "ended" },
    ],
    ...overrides,
  };
}

describe("sumMatchingCdrs", () => {
  test("sums distinct CDRs for both legs of a bridged call", () => {
    const call = makeCall();
    const records = [
      { id: "cdr1", telnyx_call_control_id: "cc-pstn", cost: "0.0035", currency: "USD", billed_sec: 60, call_sec: 60 },
      { id: "cdr2", telnyx_call_control_id: "cc-webrtc", cost: "0.002", currency: "USD", billed_sec: 60, call_sec: 60 },
    ];
    const totals = sumMatchingCdrs(call, records);
    expect(totals.cost).toBeCloseTo(0.0055, 6);
    expect(totals.currency).toBe("USD");
    // Both legs are billed independently...
    expect(totals.billedSecs).toBe(120);
    // ...but talk time is the longest leg, not the sum of concurrent legs.
    expect(totals.callSecs).toBe(60);
  });

  test("uses the longest leg for duration when legs differ", () => {
    const call = makeCall();
    const records = [
      { id: "cdr1", telnyx_call_control_id: "cc-pstn", cost: "0.0035", call_sec: 61 },
      { id: "cdr2", telnyx_call_control_id: "cc-webrtc", cost: "0.002", call_sec: 12 },
    ];
    expect(sumMatchingCdrs(call, records).callSecs).toBe(61);
  });

  test("matches by stored call_leg_id", () => {
    const call = makeCall({
      telnyxSessionId: null,
      legs: [{ callControlId: "cc", sessionId: null, telnyxLegId: "leg-1", role: "webrtc", state: "ended" }],
    });
    const records = [{ id: "cdr1", call_leg_id: "leg-1", cost: "0.002", currency: "USD" }];
    expect(sumMatchingCdrs(call, records).cost).toBeCloseTo(0.002, 6);
  });

  test("does not double count a CDR seen twice", () => {
    const call = makeCall();
    const records = [
      { id: "cdr1", telnyx_session_id: "sess-abc", cost: "0.002", currency: "USD" },
      { id: "cdr1", telnyx_session_id: "sess-abc", cost: "0.002", currency: "USD" },
    ];
    expect(sumMatchingCdrs(call, records).cost).toBeCloseTo(0.002, 6);
  });

  test("parses currency-formatted cost strings", () => {
    const call = makeCall();
    const records = [{ id: "cdr1", telnyx_call_control_id: "cc-pstn", cost: "$0.2135" }];
    expect(sumMatchingCdrs(call, records).cost).toBeCloseTo(0.2135, 6);
  });

  test("ignores unrelated CDRs and returns null cost", () => {
    const call = makeCall();
    const records = [{ id: "x", telnyx_session_id: "other", cost: "9.99", currency: "USD" }];
    const totals = sumMatchingCdrs(call, records);
    expect(totals.cost).toBeNull();
    expect(totals.cdrIds).toHaveLength(0);
  });

  test("matches an outbound call by direction + caller/callee + time window", () => {
    const startedAt = new Date().toISOString();
    const call = makeCall({
      direction: "outbound",
      from: "+12078568756",
      to: "+12075035819",
      startedAt,
      telnyxSessionId: null,
      legs: [],
    });
    const records = [
      {
        id: "out-webrtc",
        direction: "outbound",
        cli: "+12078568756",
        cld: "+12075035819",
        started_at: startedAt,
        cost: "0.0008",
        currency: "USD",
      },
      {
        id: "out-sip",
        direction: "outbound",
        caller_number: "12078568756",
        dest_number: "+12075035819",
        started_at: startedAt,
        cost: "0.005",
        currency: "USD",
      },
    ];
    expect(sumMatchingCdrs(call, records).cost).toBeCloseTo(0.0058, 6);
  });

  test("never uses fallback matching once the call has Telnyx ids", () => {
    const startedAt = new Date().toISOString();
    const call = makeCall({ direction: "outbound", startedAt });
    const records = [
      {
        id: "looks-same",
        direction: "outbound",
        cli: call.from,
        cld: call.to,
        started_at: startedAt,
        cost: "0.35",
      },
    ];
    expect(sumMatchingCdrs(call, records).cost).toBeNull();
  });

  test("does not match outbound CDRs far outside the time window", () => {
    const call = makeCall({
      direction: "outbound",
      from: "+12078568756",
      to: "+12075035819",
      telnyxSessionId: null,
      legs: [],
    });
    const records = [
      {
        id: "old",
        direction: "outbound",
        cli: "+12078568756",
        cld: "+12075035819",
        started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        cost: "0.005",
        currency: "USD",
      },
    ];
    expect(sumMatchingCdrs(call, records).cost).toBeNull();
  });

  test("consumed set stops a CDR being attributed to two calls", () => {
    const startedAt = new Date().toISOString();
    const first = makeCall({
      id: "a",
      direction: "outbound",
      from: "+12078568756",
      to: "+12075035819",
      startedAt,
      telnyxSessionId: null,
      legs: [],
    });
    const second = makeCall({ ...first, id: "b" });
    const records = [
      {
        id: "shared",
        direction: "outbound",
        cli: "+12078568756",
        cld: "+12075035819",
        started_at: startedAt,
        cost: "0.35",
      },
    ];
    const consumed = new Set<string>();
    expect(sumMatchingCdrs(first, records, consumed).cost).toBeCloseTo(0.35, 6);
    expect(sumMatchingCdrs(second, records, consumed).cost).toBeNull();
  });
});

describe("matchCallCdrs", () => {
  test("matches an id-less outbound call by session group despite a coarse CDR clock", () => {
    const call = makeCall({
      direction: "outbound",
      from: "+12078568756",
      to: "+12075035819",
      startedAt: "2026-09-20T08:47:12.000Z",
      telnyxSessionId: null,
      legs: [],
    });
    const records = [
      {
        id: "pstn",
        call_session_id: "sess-out",
        direction: "outbound",
        cli: "+12078568756",
        cld: "+12075035819",
        date_time: "2026-09-20T08:00:00Z",
        cost: "0.3500",
        currency: "USD",
        billed_sec: 4200,
        call_sec: 4200,
      },
      {
        id: "webrtc",
        call_session_id: "sess-out",
        direction: "outbound",
        cli: "+12078568756",
        cld: "+12075035819",
        date_time: "2026-09-20T08:00:00Z",
        cost: "0.0002",
        currency: "USD",
        billed_sec: 12,
        call_sec: 12,
      },
    ];
    // The tight id-less fallback can't bridge the hour-rounded clock...
    expect(sumMatchingCdrs(call, records).cost).toBeNull();
    // ...but session grouping can, and it reports the session to persist.
    const totals = matchCallCdrs(call, records);
    expect(totals.cost).toBeCloseTo(0.3502, 6);
    expect(totals.sessionId).toBe("sess-out");
    expect(totals.callSecs).toBe(4200);
    expect(totals.billedSecs).toBe(4212);
  });

  test("session groups are consumed once across calls", () => {
    const startedAt = "2026-09-20T08:47:12.000Z";
    const first = makeCall({
      id: "a",
      direction: "outbound",
      from: "+12078568756",
      to: "+12075035819",
      startedAt,
      telnyxSessionId: null,
      legs: [],
    });
    const second = makeCall({ ...first, id: "b" });
    const records = [
      {
        id: "pstn",
        call_session_id: "sess-out",
        direction: "outbound",
        cli: "+12078568756",
        cld: "+12075035819",
        date_time: "2026-09-20T08:00:00Z",
        cost: "0.35",
      },
    ];
    const consumed = new Set<string>();
    expect(matchCallCdrs(first, records, consumed).cost).toBeCloseTo(0.35, 6);
    expect(matchCallCdrs(second, records, consumed).cost).toBeNull();
  });

  test("keeps concurrent same-party calls on separate sessions", () => {
    const base = {
      direction: "outbound" as const,
      from: "+12078568756",
      to: "+12075035819",
      telnyxSessionId: null,
      legs: [],
    };
    const first = makeCall({ ...base, id: "a", startedAt: "2026-09-20T08:00:00.000Z" });
    const second = makeCall({ ...base, id: "b", startedAt: "2026-09-20T08:30:00.000Z" });
    const records = [
      {
        id: "s1",
        call_session_id: "sess-a",
        direction: "outbound",
        cli: "+12078568756",
        cld: "+12075035819",
        date_time: "2026-09-20T08:00:00Z",
        cost: "0.10",
      },
      {
        id: "s2",
        call_session_id: "sess-b",
        direction: "outbound",
        cli: "+12078568756",
        cld: "+12075035819",
        date_time: "2026-09-20T08:30:00Z",
        cost: "0.20",
      },
    ];
    const consumed = new Set<string>();
    const a = matchCallCdrs(first, records, consumed);
    const b = matchCallCdrs(second, records, consumed);
    expect(a.cost).toBeCloseTo(0.1, 6);
    expect(a.sessionId).toBe("sess-a");
    expect(b.cost).toBeCloseTo(0.2, 6);
    expect(b.sessionId).toBe("sess-b");
  });

  test("does not session-match once the call has Telnyx ids", () => {
    const call = makeCall({
      direction: "outbound",
      startedAt: "2026-09-20T08:47:12.000Z",
    });
    const records = [
      {
        id: "x",
        call_session_id: "other",
        direction: "outbound",
        cli: call.from,
        cld: call.to,
        date_time: "2026-09-20T08:00:00Z",
        cost: "0.35",
      },
    ];
    expect(matchCallCdrs(call, records).cost).toBeNull();
  });
});
