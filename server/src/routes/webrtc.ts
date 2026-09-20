import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import type { TokenResponseDto } from "@virtual-phone/shared";
import { requireSession } from "../auth/session";
import {
  NumberInUseError,
  getOccupancy,
  heartbeat,
  issueToken,
  listSessionRegistrations,
  pruneExpiredCredentials,
  releaseNumber,
  takeoverNumber,
  unregisterTab,
} from "../telnyx/credentials";

export const webrtcRouter = Router();

webrtcRouter.use(requireSession);

const TokenBody = z.object({
  numberId: z.string().min(1),
  tabId: z.string().min(1).max(64),
  device: z.string().max(120).optional(),
});

async function handleIssue(req: Request, res: Response, body: unknown) {
  const parsed = TokenBody.safeParse(body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: "bad_request", message: "numberId and tabId required" } });
    return;
  }
  try {
    const issued = await issueToken({
      sessionId: req.sessionId!,
      tabId: parsed.data.tabId,
      numberId: parsed.data.numberId,
      ...(parsed.data.device ? { device: parsed.data.device } : {}),
    });
    const dto: TokenResponseDto = {
      loginToken: issued.loginToken,
      sipUsername: issued.sipUsername,
      numberId: parsed.data.numberId,
      phoneNumber: issued.phoneNumber,
      expiresInSecs: 24 * 60 * 60,
    };
    res.json(dto);
  } catch (error) {
    if (error instanceof NumberInUseError) {
      res.status(409).json({
        error: { code: "number_in_use", message: error.message },
        holder: error.holder,
      });
      return;
    }
    res.status(400).json({
      error: {
        code: "token_failed",
        message: error instanceof Error ? error.message : "Failed to issue token",
      },
    });
  }
}

webrtcRouter.post("/webrtc/token", (req, res) => handleIssue(req, res, req.body));
webrtcRouter.post("/webrtc/refresh", (req, res) => handleIssue(req, res, req.body));

const HeartbeatBody = z.object({
  tabId: z.string().min(1).max(64),
  numberId: z.string().min(1).optional(),
});

webrtcRouter.post("/webrtc/heartbeat", async (req, res) => {
  const parsed = HeartbeatBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: "bad_request", message: "tabId required" } });
    return;
  }
  const registered = await heartbeat(req.sessionId!, parsed.data.tabId, parsed.data.numberId);
  res.json({ ok: true, registered });
});

const TakeoverBody = z.object({ numberId: z.string().min(1) });

/** Force-release a number from another tab/session and take it over. */
webrtcRouter.post("/webrtc/takeover", async (req, res) => {
  const parsed = TakeoverBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: "bad_request", message: "numberId required" } });
    return;
  }
  const result = await takeoverNumber(parsed.data.numberId);
  res.json({ ok: true, revoked: result.revoked.length });
});

webrtcRouter.delete("/webrtc/register", async (req, res) => {
  const tabId = typeof req.query.tabId === "string" ? req.query.tabId : undefined;
  if (!tabId) {
    res.status(400).json({ error: { code: "bad_request", message: "tabId required" } });
    return;
  }
  await unregisterTab(req.sessionId!, tabId);
  res.json({ ok: true });
});

const ReleaseBody = z.object({
  tabId: z.string().min(1).max(64),
  numberId: z.string().min(1).optional(),
});

webrtcRouter.post("/webrtc/release", async (req, res) => {
  const parsed = ReleaseBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: "bad_request", message: "tabId required" } });
    return;
  }
  await releaseNumber(req.sessionId!, parsed.data.tabId, parsed.data.numberId);
  res.json({ ok: true });
});

webrtcRouter.get("/webrtc/status", async (req, res) => {
  const [registrations, occupancy] = await Promise.all([
    listSessionRegistrations(req.sessionId!),
    getOccupancy(),
  ]);
  res.json({ registrations, occupancy });
});

webrtcRouter.post("/webrtc/prune", async (_req, res) => {
  await pruneExpiredCredentials();
  res.json({ ok: true });
});
