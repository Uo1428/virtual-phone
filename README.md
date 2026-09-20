# Virtual Phone

Browser softphone on Telnyx. Multi-number, per-tab/per-browser sessions, inbound + outbound,
server-side history/cost. One process serves both the API and the built web app.

See [PLAN.md](../express-call-control/PLAN.md) for the full phase plan.

## Stack

- Runtime: **Bun** (installs, runs TS, tests)
- Server: Express 5 + `telnyx@7` + `lowdb` (local JSON DB)
- Web: React + Vite + TypeScript + `@telnyx/webrtc@2`
- UI: **`@virtual-phone/ui`** (`packages/ui`, beUI/Tailwind design system) + `reicon-react` + `motion`

## Layout

```
virtual-phone/
  packages/ui/  # shared design system (@virtual-phone/ui)
  shared/       # zod schemas + types (@virtual-phone/shared)
  server/       # Express API + serves web build
  web/          # React SPA (builds to server/public)
```

## Setup

```bash
bun install
cp .env.sample .env   # then fill in values
```

## Dev

```bash
bun run dev     # server (3000, bun --watch) + Vite (5173, HMR, proxies /api -> 3000)
```

Open http://localhost:5173. Telnyx webhooks still arrive on the public URL
(`PUBLIC_URL` + `/api/telnyx/webhooks`) → your proxy → port 3000, so inbound works in dev.

Notes:
- One number can be connected by only one tab at a time. If a number is held elsewhere,
  Connect returns `409 number_in_use` and the UI shows "In use".
- Switching numbers in a tab auto-releases the previous one; Disconnect releases too.
- `GET /api/overview` powers the dashboard (numbers + occupancy + today's cost + recent calls/logs).

## Build & run (single host)

```bash
bun run build   # builds web -> server/public
bun run start   # Express serves API + SPA on :3000
```

## Quality gates

```bash
bun run typecheck
bun run lint
bun run format
bun test
```
