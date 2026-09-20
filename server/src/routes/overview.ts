import { Router } from "express";
import { requireSession } from "../auth/session";
import { getDb } from "../db/db";
import { getOccupancy } from "../telnyx/credentials";

export const overviewRouter = Router();

overviewRouter.use(requireSession);

/** Single call for the dashboard: numbers + occupancy + recent activity + cost. */
overviewRouter.get("/overview", async (req, res) => {
  const db = await getDb();
  const occupancy = await getOccupancy();
  const sessionId = req.sessionId!;
  const since = Date.now() - 24 * 60 * 60 * 1000;

  const calls = db.data.calls
    .filter((c) => c.sessionId === sessionId)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  const todayCalls = calls.filter((c) => Date.parse(c.startedAt) >= since);

  res.json({
    numbers: db.data.numbers,
    occupancy,
    discovery: {
      callControlApp: db.data.callControlApp,
      credentialConnection: db.data.credentialConnection,
      lastDiscoveryAt: db.data.settings.lastDiscoveryAt,
    },
    cost: {
      range: "today" as const,
      totalCost: Number(todayCalls.reduce((s, c) => s + (c.cost ?? 0), 0).toFixed(4)),
      currency: todayCalls.find((c) => c.currency)?.currency ?? null,
      callCount: todayCalls.length,
      totalDurationSecs: todayCalls.reduce((s, c) => s + (c.durationSecs ?? 0), 0),
    },
    recentCalls: calls.slice(0, 10),
    recentEvents: db.data.events.slice(-25).reverse(),
  });
});
