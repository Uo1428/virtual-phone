import { Router } from "express";
import { z } from "zod";
import type { SessionDto } from "@virtual-phone/shared";
import { env } from "../env";
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  expiredSessionCookie,
  isSecureRequest,
  requireSession,
  resolveSession,
  sessionCookie,
} from "../auth/session";
import { logger } from "../log/logger";

export const authRouter = Router();

const LoginBody = z.object({ passcode: z.string().optional() });

authRouter.post("/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: "bad_request", message: "Invalid body" } });
    return;
  }
  if (env.APP_PASSCODE && parsed.data.passcode !== env.APP_PASSCODE) {
    logger.warn("login_rejected", { reason: "bad_passcode" });
    res.status(401).json({ error: { code: "invalid_passcode", message: "Invalid passcode" } });
    return;
  }
  const session = await createSession();
  res.setHeader("Set-Cookie", sessionCookie(session, isSecureRequest(req)));
  logger.info("login_ok", { sessionId: session.id });
  const dto: SessionDto = {
    id: session.id,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  };
  res.json(dto);
});

authRouter.post("/logout", requireSession, async (req, res) => {
  if (req.sessionId) await destroySession(req.sessionId);
  res.setHeader("Set-Cookie", expiredSessionCookie(isSecureRequest(req)));
  res.json({ ok: true });
});

authRouter.get("/session", async (req, res) => {
  const session = await resolveSession(req.cookies?.[SESSION_COOKIE] as string | undefined);
  if (!session) {
    res.status(401).json({ error: { code: "unauthorized", message: "Login required" } });
    return;
  }
  const dto: SessionDto = {
    id: session.id,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  };
  res.json(dto);
});
