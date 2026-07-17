---
name: run-dashboard
description: Run, launch, start, or screenshot the Splyntra dashboard (apps/web, the Next.js web UI). Boots Postgres, starts the dev server, logs in, and drives/screenshots authenticated routes with a headless-Chrome driver. Use to see a UI change in the real running app, capture a screenshot, or verify a dashboard flow end-to-end.
---

# Run the Splyntra dashboard (apps/web)

`apps/web` is the Next.js dashboard, published as `@splyntra/dashboard`. Every
route is gated behind login (NextAuth Credentials → Postgres). It proxies all
trace/metric data through the **collector** at runtime; with no collector
running, pages still render but data widgets return 502 and show zeros — that's
expected and fine for driving/screenshotting the UI.

You drive it headlessly with [driver.mjs](.claude/skills/run-dashboard/driver.mjs),
which launches the installed Google Chrome via `puppeteer-core`, handles the
signup/login flow, and screenshots any route.

**All paths below are relative to `apps/web/`.** The driver lives at
`.claude/skills/run-dashboard/driver.mjs`.

## Prerequisites

- **Docker running** (for Postgres). On macOS: `open -a Docker`, wait ~15s for the daemon.
- **Node 24** (repo pins it in `.node-version`) and **Google Chrome** installed
  (`/Applications/Google Chrome.app` on macOS). The driver reuses it — no browser download.

## Setup

Postgres is the only backing service the dashboard needs to log in. Run it
standalone with the repo migrations mounted (they auto-seed the "Dev
Organization" that signup joins). Run from the **repo root**:

```bash
docker rm -f splyntra-pg 2>/dev/null
docker run -d --name splyntra-pg \
  -e POSTGRES_USER=splyntra -e POSTGRES_PASSWORD=splyntra -e POSTGRES_DB=splyntra \
  -p 5432:5432 \
  -v "$PWD/migrations/postgres:/docker-entrypoint-initdb.d:ro" \
  postgres:16-alpine
# wait for init + migrations, then confirm the seeded org exists:
sleep 6
docker exec splyntra-pg psql -U splyntra -d splyntra -c "select name from organizations;"
```

Install web deps (skip if `apps/web/node_modules` already exists) and the driver's deps:

```bash
# from apps/web
npm install
# from apps/web/.claude/skills/run-dashboard
PUPPETEER_SKIP_DOWNLOAD=1 npm install
```

## Run (agent path)

Start the dev server in the background from `apps/web`. `NODE_ENV=development`
enables the fixed dev auth secret (so `AUTH_SECRET` need not be set):

```bash
# from apps/web
NODE_ENV=development \
POSTGRES_DSN='postgres://splyntra:splyntra@localhost:5432/splyntra?sslmode=disable' \
COLLECTOR_URL='http://localhost:4318' \
SPLYNTRA_API_KEY='splyntra_dev_key' \
PORT=3000 \
  nohup npm run dev > /tmp/web-dev.log 2>&1 &
# wait until it answers:
until curl -sf -o /dev/null http://localhost:3000/login; do sleep 2; done; echo UP
```

Then drive it. **First run must be `signup`** (creates the first user, who joins
the seeded dev org as owner). After that, `shot`/`shots`/`open` log in with the
same creds automatically. Run the driver from `apps/web/.claude/skills/run-dashboard`:

```bash
# create the first user + screenshot the Overview page → shots/home.png
node driver.mjs signup

# screenshot one route (logs in automatically)
node driver.mjs shot /projects projects        # → shots/projects.png

# screenshot several routes in one login
node driver.mjs shots "/agents,/security,/costs"

# print title + h1 for a route (no screenshot) — quick "did it render" check
node driver.mjs open /costs
```

Screenshots land in `.claude/skills/run-dashboard/shots/` (gitignored). Default
creds are `dev@splyntra.local` / `splyntra-dev-pw`; override with `EMAIL=` /
`PASSWORD=` env vars. **Look at the screenshot** — a good one shows the sidebar
plus `dev@splyntra.local / OWNER` and `Connected · v1.6.0` bottom-left.

Real routes: `/` (Overview), `/agents`, `/platforms`, `/mcp`, `/traces`,
`/logs`, `/metrics`, `/tools`, `/evaluations`, `/security`, `/costs`,
`/projects`, `/alerts`. (There is **no** `/settings` route — it 404s; settings
live under `/projects` and `/alerts`.)

## Run (human path)

`npm run dev` from `apps/web` and open http://localhost:3000 in a browser — it
redirects to `/login`; go to `/signup` to create the first account. Useless
headless, which is why the driver above exists.

## Test

```bash
# from apps/web
npx vitest run
```

## Gotchas

- **Why not `task dev` / full compose?** This repo's `docker-compose.yml` *builds*
  all four app services from source (`build: context: ./apps/...`) — it does not
  pull images — so it does work from a clean machine, it just builds collector +
  security + evaluation + web too. For a dashboard-only UI change that's overkill;
  standalone Postgres + `npm run dev` is faster and needs no collector. (Don't
  confuse this with the **splyntra-cloud** compose, which *does* pull prebuilt
  `ghcr.io/splyntra/{collector-cloud,cloud-web,usage}` images that only exist after
  a `v*` tag.) The published open-core images `ghcr.io/splyntra/{collector,security,
  evaluation,web}:<version>` come from `.github/workflows/docker.yml` on a `v*` tag.
- **Base-compose Postgres is `expose`-only**, but `docker-compose.override.yml`
  (auto-merged) publishes it to the host on `:5432`. Setup here uses a standalone
  `docker run -p 5432:5432` instead, to avoid bringing up the whole compose network.
- **Every route is login-gated** by `src/middleware.ts`. Hitting any URL
  unauthenticated 302s to `/login`. The driver's `signup`/login flow is the only
  way in; there's no anonymous page except `/login` and `/signup`.
- **502 Bad Gateway console errors are normal** with no collector running — the
  dashboard proxies data through the collector (`src/app/api/v1/[...path]/route.ts`).
  Pages render; trace/metric widgets show zeros. Postgres-backed pages
  (`/projects`, `/alerts`, auth) show real data.
- **First user only becomes owner if the org has zero members.** If you re-run
  signup with a new email against an already-populated org, it joins as a plain
  member. Wipe state with `docker rm -f splyntra-pg` and re-run setup.
- **The dev auth secret only activates when `NODE_ENV=development`.** Launch
  without it and NextAuth hard-fails at startup (fail-closed) unless you set `AUTH_SECRET`.

## Troubleshooting

- **Signup lands back on `/login` / driver falls through to signup repeatedly** —
  Postgres isn't reachable or migrations didn't run. Check
  `docker exec splyntra-pg psql -U splyntra -d splyntra -c "\dt"` shows ~17 tables
  incl. `users`, `organizations`.
- **`Error: Chrome not found`** — set `CHROME=/path/to/chrome` (the driver
  auto-detects `/Applications/Google Chrome.app` on macOS only).
- **Server never comes up / `next dev` exits** — check `/tmp/web-dev.log`. The
  `Should not import the named export 'version'` warning about `Sidebar.tsx` is
  benign (a lint warning, not a failure).
- **Port 3000 in use** — set a different `PORT=` and matching `BASE_URL=` env for the driver.
