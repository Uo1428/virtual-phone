import { getDb, mutate } from "../db/db";
import type { Registration } from "../db/db";
import { requireTelnyx } from "./client";
import { logger } from "../log/logger";
import { recordEvent } from "../events/eventStore";
import { broadcastState } from "../events/bus";

/** Tell every connected tab that number occupancy changed. */
function notifyOccupancy(): void {
  broadcastState({ type: "occupancy" });
}

const CREDENTIAL_TTL_MS = 24 * 60 * 60 * 1000;
export const ONLINE_WINDOW_MS = 90 * 1000;

export interface NumberHolder {
  tabId: string;
  sessionId: string;
  since: string;
  sipUsername: string;
  device: string | null;
}

export class NumberInUseError extends Error {
  constructor(public readonly holder: NumberHolder) {
    super("This number is already connected in another tab");
    this.name = "NumberInUseError";
  }
}

function toHolder(reg: Registration): NumberHolder {
  return {
    tabId: reg.tabId,
    sessionId: reg.sessionId,
    since: reg.createdAt,
    sipUsername: reg.sipUsername,
    device: reg.device ?? null,
  };
}

export interface IssuedToken {
  loginToken: string;
  sipUsername: string;
  credentialId: string;
  phoneNumber: string;
}

export interface TokenRequest {
  sessionId: string;
  tabId: string;
  numberId: string;
  device?: string;
}

/**
 * Ensure the session+tab has a dedicated telephony credential (one per tab, so
 * inbound registrations do not clash) and mint a WebRTC login token for it.
 */
export async function issueToken(req: TokenRequest): Promise<IssuedToken> {
  const client = requireTelnyx();
  const db = await getDb();
  const connection = db.data.credentialConnection;
  if (!connection?.id) {
    throw new Error("Credential connection not discovered yet. Run discovery first.");
  }
  const number = db.data.numbers.find((n) => n.id === req.numberId);
  if (!number) throw new Error("Unknown number");

  const now = Date.now();

  const findHolder = (registrations: Registration[]): Registration | undefined =>
    findNumberHolder(registrations, req.numberId, req.sessionId, req.tabId, now);

  // Fast path: fail before spending a Telnyx credential.
  const earlyHolder = findHolder(db.data.registrations);
  if (earlyHolder) throw new NumberInUseError(toHolder(earlyHolder));

  const existing = db.data.registrations.find(
    (r) =>
      r.sessionId === req.sessionId &&
      r.tabId === req.tabId &&
      r.numberId === req.numberId &&
      Date.parse(r.createdAt) > now - CREDENTIAL_TTL_MS,
  );

  let registration: Registration;
  let createdCredentialId: string | null = null;
  if (existing) {
    registration = existing;
    if (req.device) registration.device = req.device;
  } else {
    const created = await client.telephonyCredentials.create({
      connection_id: connection.id,
      name: `vp-${req.sessionId.slice(0, 8)}-${req.tabId.slice(0, 12)}`,
    });
    const credentialId = created.data?.id;
    const sipUsername = created.data?.sip_username;
    if (!credentialId || !sipUsername) throw new Error("Credential creation failed");
    createdCredentialId = credentialId;
    registration = {
      credentialId,
      sipUsername,
      numberId: req.numberId,
      sessionId: req.sessionId,
      tabId: req.tabId,
      device: req.device ?? null,
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
    };
  }

  // Atomic reserve: re-check and insert under the serialized write chain, so
  // two tabs connecting the same number at once cannot both win.
  const conflict = await mutate<Registration | null>((data) => {
    const holder = findHolder(data.registrations);
    if (holder) return holder;
    if (createdCredentialId) {
      data.registrations = data.registrations.filter((r) => r.credentialId !== createdCredentialId);
    }
    data.registrations = data.registrations.filter(
      (r) => r.credentialId !== registration.credentialId,
    );
    data.registrations.push(registration);
    return null;
  });

  if (conflict) {
    if (createdCredentialId) {
      await client.telephonyCredentials.delete(createdCredentialId).catch(() => undefined);
    }
    throw new NumberInUseError(toHolder(conflict));
  }

  if (createdCredentialId) {
    logger.info("webrtc_credential_created", {
      credentialId: createdCredentialId,
      sipUsername: registration.sipUsername,
    });
    void recordEvent({
      source: "system",
      type: "webrtc_credential_created",
      message: `credential for ${number.phoneNumber}`,
      raw: { credentialId: createdCredentialId },
    });
  }

  const tokenResponse = await client.telephonyCredentials.createToken(registration.credentialId);
  const loginToken = typeof tokenResponse === "string" ? tokenResponse : String(tokenResponse);

  await mutate((data) => {
    const row = data.registrations.find((r) => r.credentialId === registration.credentialId);
    if (row) row.lastSeenAt = new Date().toISOString();
  });
  notifyOccupancy();

  return {
    loginToken,
    sipUsername: registration.sipUsername,
    credentialId: registration.credentialId,
    phoneNumber: number.phoneNumber,
  };
}

/** Refresh liveness. Returns false when the tab no longer holds the number. */
export async function heartbeat(
  sessionId: string,
  tabId: string,
  numberId?: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const registered = await mutate<boolean>((data) => {
    let any = false;
    for (const r of data.registrations) {
      if (r.sessionId === sessionId && r.tabId === tabId && (!numberId || r.numberId === numberId)) {
        r.lastSeenAt = now;
        any = true;
      }
    }
    return any;
  });
  notifyOccupancy();
  return registered;
}

export async function unregisterTab(sessionId: string, tabId: string): Promise<void> {
  await mutate((data) => {
    data.registrations = data.registrations.filter(
      (r) => !(r.sessionId === sessionId && r.tabId === tabId),
    );
  });
  notifyOccupancy();
}

export async function releaseNumber(
  sessionId: string,
  tabId: string,
  numberId?: string,
): Promise<void> {
  await mutate((data) => {
    data.registrations = data.registrations.filter(
      (r) =>
        !(
          r.sessionId === sessionId &&
          r.tabId === tabId &&
          (!numberId || r.numberId === numberId)
        ),
    );
  });
  notifyOccupancy();
}

/**
 * Force-release a number from whoever holds it (any session/tab) and tell the
 * holder to drop its connection. Used when a user takes the number over.
 */
export async function takeoverNumber(numberId: string): Promise<{ revoked: Registration[] }> {
  const revoked = await mutate<Registration[]>((data) => {
    const removed = data.registrations.filter((r) => r.numberId === numberId);
    data.registrations = data.registrations.filter((r) => r.numberId !== numberId);
    return removed;
  });
  notifyOccupancy();
  for (const r of revoked) {
    broadcastState({ type: "revoked", numberId, tabId: r.tabId, device: r.device ?? null });
  }
  logger.info("number_taken_over", { numberId, revoked: revoked.length });
  void recordEvent({
    source: "system",
    type: "number_taken_over",
    message: `number released from ${revoked.length} holder(s)`,
    level: "warn",
  });
  return { revoked };
}

export interface OccupancyEntry {
  numberId: string;
  tabId: string;
  sessionId: string;
  device: string | null;
  online: boolean;
  since: string;
}

/** Current online holder for every known number (across all sessions). */
export async function getOccupancy(): Promise<Record<string, OccupancyEntry | null>> {
  const db = await getDb();
  const now = Date.now();
  const out: Record<string, OccupancyEntry | null> = {};
  for (const number of db.data.numbers) {
    const holder = db.data.registrations.find(
      (r) => r.numberId === number.id && now - Date.parse(r.lastSeenAt) < ONLINE_WINDOW_MS,
    );
    out[number.id] = holder
      ? {
          numberId: number.id,
          tabId: holder.tabId,
          sessionId: holder.sessionId,
          device: holder.device ?? null,
          online: true,
          since: holder.createdAt,
        }
      : null;
  }
  return out;
}

export interface RegistrationStatus extends Registration {
  online: boolean;
}

export async function listSessionRegistrations(sessionId: string): Promise<RegistrationStatus[]> {
  const db = await getDb();
  const now = Date.now();
  return db.data.registrations
    .filter((r) => r.sessionId === sessionId)
    .map((r) => ({ ...r, online: now - Date.parse(r.lastSeenAt) < ONLINE_WINDOW_MS }));
}

export function onlineForNumber(
  registrations: Registration[],
  numberId: string,
  now = Date.now(),
): Registration[] {
  return registrations.filter(
    (r) => r.numberId === numberId && now - Date.parse(r.lastSeenAt) < ONLINE_WINDOW_MS,
  );
}

/**
 * The registration currently holding a number, if any. Excludes the caller's
 * own session+tab so re-connecting from the same tab is not a conflict.
 */
export function findNumberHolder(
  registrations: Registration[],
  numberId: string,
  sessionId: string,
  tabId: string,
  now = Date.now(),
): Registration | undefined {
  return registrations.find(
    (r) =>
      r.numberId === numberId &&
      !(r.sessionId === sessionId && r.tabId === tabId) &&
      now - Date.parse(r.lastSeenAt) < ONLINE_WINDOW_MS,
  );
}

/** Delete credentials for registrations older than the TTL. */
export async function pruneExpiredCredentials(): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const expired = db.data.registrations.filter(
    (r) => Date.parse(r.createdAt) < now - CREDENTIAL_TTL_MS,
  );
  if (expired.length === 0) return;
  const client = requireTelnyx();
  for (const reg of expired) {
    try {
      await client.telephonyCredentials.delete(reg.credentialId);
    } catch (error) {
      logger.warn("credential_prune_failed", {
        credentialId: reg.credentialId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const ids = new Set(expired.map((r) => r.credentialId));
  await mutate((data) => {
    data.registrations = data.registrations.filter((r) => !ids.has(r.credentialId));
  });
  notifyOccupancy();
  logger.info("credentials_pruned", { count: expired.length });
}
