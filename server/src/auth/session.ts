import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { getDb, mutate } from "../db/db";
import type { SessionRecord } from "../db/db";
import { env } from "../env";
import { logger } from "../log/logger";

export const SESSION_COOKIE = "vp_session";
const TTL_MS = 24 * 60 * 60 * 1000;
const devSecret = crypto.randomBytes(32).toString("hex");

function signingSecret(): string {
  return env.SESSION_SECRET ?? devSecret;
}

function sign(id: string): string {
  return crypto.createHmac("sha256", signingSecret()).update(id).digest("base64url");
}

function buildCookie(value: string, maxAgeSecs: number, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSecs}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function sessionCookie(session: SessionRecord, secure: boolean): string {
  const raw = `${session.id}.${sign(session.id)}`;
  return buildCookie(raw, Math.floor(TTL_MS / 1000), secure);
}

export function expiredSessionCookie(secure: boolean): string {
  return buildCookie("", 0, secure);
}

export function isSecureRequest(req: {
  secure?: boolean;
  headers: Record<string, unknown>;
}): boolean {
  const forwarded = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return req.secure === true || proto === "https";
}

export async function createSession(): Promise<SessionRecord> {
  const now = Date.now();
  const record: SessionRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
  };
  await mutate((data) => {
    data.sessions = data.sessions.filter((s) => Date.parse(s.expiresAt) > now);
    data.sessions.push(record);
  });
  return record;
}

export async function destroySession(id: string): Promise<void> {
  await mutate((data) => {
    data.sessions = data.sessions.filter((s) => s.id !== id);
  });
}

export async function resolveSession(raw: string | undefined): Promise<SessionRecord | null> {
  if (!raw) return null;
  const [id, signature] = raw.split(".");
  if (!id || !signature) return null;
  const expected = sign(id);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const db = await getDb();
  const session = db.data.sessions.find((s) => s.id === id);
  if (!session || Date.parse(session.expiresAt) < Date.now()) return null;
  return session;
}

export const requireSession: RequestHandler = (req, res, next) => {
  void resolveSession(req.cookies?.[SESSION_COOKIE] as string | undefined)
    .then((session) => {
      if (!session) {
        res.status(401).json({ error: { code: "unauthorized", message: "Login required" } });
        return;
      }
      req.sessionId = session.id;
      next();
    })
    .catch((error: unknown) => {
      logger.error("session_lookup_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: { code: "internal_error", message: "Internal error" } });
    });
};
