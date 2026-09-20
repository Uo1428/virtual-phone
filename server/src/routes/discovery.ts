import { Router } from "express";
import { getDb } from "../db/db";
import { requireSession } from "../auth/session";
import { assignNumberToApp, runDiscovery } from "../telnyx/discovery";
import { getOccupancy } from "../telnyx/credentials";
import { logger } from "../log/logger";

export const discoveryRouter = Router();

discoveryRouter.use(requireSession);

discoveryRouter.get("/discovery", async (_req, res) => {
  const db = await getDb();
  res.json({
    callControlApp: db.data.callControlApp,
    credentialConnection: db.data.credentialConnection,
    outboundVoiceProfile: db.data.outboundVoiceProfile,
    numbers: db.data.numbers,
    lastDiscoveryAt: db.data.settings.lastDiscoveryAt,
  });
});

discoveryRouter.post("/discovery/refresh", async (_req, res) => {
  const result = await runDiscovery();
  logger.info("discovery_refreshed", { warnings: result.warnings.length });
  res.json(result);
});

discoveryRouter.get("/numbers", async (_req, res) => {
  const db = await getDb();
  const occupancy = await getOccupancy();
  res.json({ numbers: db.data.numbers, occupancy });
});

/** Assign a number to the Call Control app (makes it able to receive inbound). */
discoveryRouter.post("/numbers/:id/assign", async (req, res) => {
  try {
    const number = await assignNumberToApp(req.params.id);
    res.json({ number });
  } catch (error) {
    res.status(400).json({
      error: {
        code: "assign_failed",
        message: error instanceof Error ? error.message : "Failed to assign number",
      },
    });
  }
});
