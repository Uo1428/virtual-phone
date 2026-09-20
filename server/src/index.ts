import express from "express";
import type { ErrorRequestHandler, RequestHandler } from "express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, assertProductionEnv } from "./env";
import { logger, onLog } from "./log/logger";
import { logSink, recordEvent } from "./events/eventStore";
import { telnyxRouter } from "./routes/telnyx";
import { authRouter } from "./routes/auth";
import { discoveryRouter } from "./routes/discovery";
import { webrtcRouter } from "./routes/webrtc";
import { callsRouter } from "./routes/calls";
import { eventsRouter } from "./routes/events";
import { costRouter } from "./routes/cost";
import { overviewRouter } from "./routes/overview";
import { runDiscoveryOnBoot } from "./telnyx/discovery";
import { pruneExpiredCredentials } from "./telnyx/credentials";
import { enforceCallTimeouts } from "./telnyx/callHandler";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const projectRoot = path.resolve(serverRoot, "..");
const publicDir = path.resolve(serverRoot, "public");
const dataDir = path.resolve(projectRoot, env.DATA_DIR);

fs.mkdirSync(dataDir, { recursive: true });

assertProductionEnv();
onLog(logSink);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(compression());
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "connect-src": ["'self'", "wss://rtc.telnyx.com", "https://*.telnyx.com"],
        "media-src": ["'self'", "blob:"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "font-src": ["'self'", "data:"],
        "worker-src": ["'self'", "blob:"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "upgrade-insecure-requests": null,
      },
    },
  }),
);

// Raw-body webhook route must be mounted before the JSON parser.
app.use("/api/telnyx", telnyxRouter);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

const health: RequestHandler = (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), version: "0.2.0" });
};
app.get("/api/health", health);

app.use("/api/auth", authRouter);
app.use("/api", discoveryRouter);
app.use("/api", webrtcRouter);
app.use("/api", callsRouter);
app.use("/api", eventsRouter);
app.use("/api", costRouter);
app.use("/api", overviewRouter);

const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Not found" } });
};
app.use("/api", apiNotFound);

// Static SPA + fallback for client-side routes (never for /api).
// Hashed assets are immutable; index.html must not be cached.
app.use(
  "/assets",
  express.static(path.join(publicDir, "assets"), { maxAge: "1y", immutable: true }),
);
app.use(express.static(publicDir, { index: false }));
const spaFallback: RequestHandler = (req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api")) {
    next();
    return;
  }
  const indexHtml = path.join(publicDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    res.status(404).json({
      error: { code: "client_not_built", message: "Run `bun run build` first." },
    });
    return;
  }
  res.sendFile(indexHtml, { headers: { "Cache-Control": "no-cache" } });
};
app.use(spaFallback);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error("request_failed", { error: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: { code: "internal_error", message: "Internal server error" } });
};
app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info("server_listening", { port: env.PORT, publicDir, dataDir });
  void recordEvent({ source: "system", type: "server_start", message: "server started" });
  void runDiscoveryOnBoot();
  void pruneExpiredCredentials().catch(() => undefined);

  // Cost is reconciled per-call when it ends (see scheduleReconcile); this
  // watchdog only hangs up calls that never connected, to stop billing.
  const watchdogTimer = setInterval(() => {
    if (!env.TELNYX_API_KEY) return;
    void enforceCallTimeouts().catch(() => undefined);
  }, 60_000);
  watchdogTimer.unref?.();
});
