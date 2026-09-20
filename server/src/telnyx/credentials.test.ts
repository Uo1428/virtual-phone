import { describe, expect, test } from "bun:test";
import type { Registration } from "../db/db";
import { ONLINE_WINDOW_MS, findNumberHolder, onlineForNumber } from "./credentials";
import { isSecureRequest } from "../auth/session";

function makeRegistration(overrides: Partial<Registration>): Registration {
  return {
    credentialId: "cred",
    sipUsername: "gencredTEST",
    numberId: "n1",
    sessionId: "s1",
    tabId: "t1",
    device: null,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("onlineForNumber", () => {
  test("returns only fresh registrations for the requested number", () => {
    const now = Date.now();
    const list = [
      makeRegistration({ numberId: "n1", lastSeenAt: new Date(now).toISOString() }),
      makeRegistration({ numberId: "n2", lastSeenAt: new Date(now).toISOString() }),
      makeRegistration({
        numberId: "n1",
        lastSeenAt: new Date(now - ONLINE_WINDOW_MS - 5_000).toISOString(),
      }),
    ];

    const result = onlineForNumber(list, "n1", now);
    expect(result).toHaveLength(1);
    expect(result[0]!.numberId).toBe("n1");
  });

  test("returns nothing when all registrations are stale", () => {
    const now = Date.now();
    const list = [
      makeRegistration({
        lastSeenAt: new Date(now - ONLINE_WINDOW_MS - 1).toISOString(),
      }),
    ];
    expect(onlineForNumber(list, "n1", now)).toHaveLength(0);
  });
});

describe("findNumberHolder", () => {
  test("finds another tab holding the number", () => {
    const reg = makeRegistration({ numberId: "n1", sessionId: "s1", tabId: "other" });
    expect(findNumberHolder([reg], "n1", "s1", "t1")?.tabId).toBe("other");
  });

  test("ignores the caller's own tab", () => {
    const reg = makeRegistration({ numberId: "n1", sessionId: "s1", tabId: "t1" });
    expect(findNumberHolder([reg], "n1", "s1", "t1")).toBeUndefined();
  });

  test("ignores stale holders past the online window", () => {
    const reg = makeRegistration({
      numberId: "n1",
      sessionId: "s1",
      tabId: "other",
      lastSeenAt: new Date(Date.now() - ONLINE_WINDOW_MS - 1).toISOString(),
    });
    expect(findNumberHolder([reg], "n1", "s1", "t1")).toBeUndefined();
  });
});

describe("isSecureRequest", () => {
  test("honours x-forwarded-proto from the proxy", () => {
    expect(isSecureRequest({ headers: { "x-forwarded-proto": "https" } })).toBe(true);
    expect(isSecureRequest({ headers: { "x-forwarded-proto": "http" } })).toBe(false);
  });

  test("falls back to the request secure flag", () => {
    expect(isSecureRequest({ secure: true, headers: {} })).toBe(true);
    expect(isSecureRequest({ secure: false, headers: {} })).toBe(false);
  });
});
