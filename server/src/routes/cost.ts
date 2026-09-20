import { Router } from "express";
import type { CostSummaryDto } from "@virtual-phone/shared";
import { requireSession } from "../auth/session";
import { getDb } from "../db/db";
import { reconcileCall } from "../telnyx/cost";

export const costRouter = Router();

costRouter.use(requireSession);

const RANGE_MS: Record<CostSummaryDto["range"], number | null> = {
  today: 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: null,
};

costRouter.get("/cost/summary", async (req, res) => {
  const rangeParam = typeof req.query.range === "string" ? req.query.range : "today";
  const range = (["today", "7d", "30d", "all"] as const).includes(
    rangeParam as CostSummaryDto["range"],
  )
    ? (rangeParam as CostSummaryDto["range"])
    : "today";
  const windowMs = RANGE_MS[range];
  const since = windowMs === null ? null : Date.now() - windowMs;

  const db = await getDb();
  const calls = db.data.calls.filter(
    (c) => c.sessionId === req.sessionId && (since === null || Date.parse(c.startedAt) >= since),
  );
  const totalCost = calls.reduce((sum, c) => sum + (c.cost ?? 0), 0);
  const totalDurationSecs = calls.reduce((sum, c) => sum + (c.durationSecs ?? 0), 0);
  const currency = calls.find((c) => c.currency)?.currency ?? null;

  const dto: CostSummaryDto = {
    range,
    totalCost: Number(totalCost.toFixed(4)),
    currency,
    callCount: calls.length,
    totalDurationSecs,
  };
  res.json(dto);
});

costRouter.post("/calls/:id/reconcile", async (req, res) => {
  const ok = await reconcileCall(req.params.id);
  res.json({ ok, reconciled: ok });
});
