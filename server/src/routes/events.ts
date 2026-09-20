import crypto from "node:crypto";
import { Router } from "express";
import { requireSession } from "../auth/session";
import { getDb } from "../db/db";
import { addClient, clientCount, removeClient } from "../events/bus";
import { logger } from "../log/logger";

export const eventsRouter = Router();

eventsRouter.use(requireSession);

eventsRouter.get("/events", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const callId = typeof req.query.callId === "string" ? req.query.callId : undefined;
  const level = typeof req.query.level === "string" ? req.query.level : undefined;
  const db = await getDb();
  const events = db.data.events
    .filter((e) => (!callId || e.callId === callId) && (!level || e.level === level))
    .slice(-limit);
  res.json({ events });
});

eventsRouter.get("/events/stream", (req, res) => {
  const id = crypto.randomUUID();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ id })}\n\n`);
  addClient(id, res);

  const keepAlive = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(keepAlive);
    }
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    removeClient(id);
    logger.debug("sse_client_closed", { id, remaining: clientCount() });
  });
});
