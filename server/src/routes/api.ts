import { Router } from 'express';
import { VERSION } from '../version';

export const apiRouter: ReturnType<typeof Router> = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), version: VERSION });
});

// Phase 2+: /auth, /numbers, /calls, /events, /webrtc, /cost, /logs, /telnyx/webhooks.
