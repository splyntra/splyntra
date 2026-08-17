<p align="center">
  <img src="https://avatars.githubusercontent.com/u/291030557?s=200" alt="Splyntra" width="80" />
</p>

<h1 align="center">@splyntra/dashboard</h1>

<p align="center"><strong>The Splyntra Open Dashboard</strong></p>

<p align="center">Unified trace visualization, logs, agent/MCP/platform metrics, cost analytics, evaluations, and security alerts.</p>

<p align="center">
  <a href="https://docs.splyntra.com"><strong>Documentation</strong></a> ·
  <a href="https://app.splyntra.com"><strong>Cloud Dashboard</strong></a> ·
  <a href="https://ingest.splyntra.com"><strong>Ingest Endpoint</strong></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@splyntra/dashboard"><img src="https://img.shields.io/npm/v/@splyntra/dashboard" alt="npm" /></a>
  <a href="https://docs.splyntra.com"><img src="https://img.shields.io/badge/docs-docs.splyntra.com-blue" alt="Docs" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-FSL--1.1--ALv2-blue.svg" alt="License" /></a>
</p>

---

Published as **source** (not a prebuilt library). Consumers compose it with their overlays and run `next build`.

## Prerequisites

- Node.js 20+
- PostgreSQL (metadata store)
- Running Splyntra Collector (`localhost:4318`)
- Running Evaluation service (`localhost:8002`) — optional

## Local Development

```bash
# From the monorepo root
docker compose up -d   # starts Postgres, ClickHouse, Collector, etc.

# From this directory
cp .env.local.example .env.local   # configure environment
npm install
npm run dev                        # http://localhost:3000
```

## Environment Variables

| Variable          | Default                          | Description                         |
|-------------------|----------------------------------|-------------------------------------|
| `COLLECTOR_URL`   | `http://localhost:4318`          | Splyntra Collector base URL used by server-side BFF proxy (`/api/v1/*`). In production, set to your collector host (e.g. `https://ingest.splyntra.com` or internal service DNS). |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4318`      | Fallback API URL if `COLLECTOR_URL` is unset. |
| `EVAL_URL`        | `http://localhost:8002`          | Evaluation service base URL.        |
| `POSTGRES_DSN`    | —                                | PostgreSQL connection string (metadata & user/team store). |
| `NEXTAUTH_URL`    | `http://localhost:3000`          | Canonical app URL (e.g. `https://app.splyntra.com`). |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | —                | Secret for Auth.js/NextAuth session token encryption. |
| `SPLYNTRA_API_KEY`| `splyntra_dev_key` (dev only)    | Collector key the dashboard proxies with; dev fallback is rejected outside `development` (fail-closed). |
| `COLLECTOR_SERVICE_TOKEN` | —                        | Shared secret for trusted multi-tenant BFF → collector communication. |

## Production Deployment Notes

- **Collector Proxying (`/api/v1/*`)**: Next.js proxies API requests dynamically to `COLLECTOR_URL` on each request rather than baking it in at build time. Ensure `COLLECTOR_URL` is set in your container/hosting environment.
- **Data Caching**: TanStack Query is configured with sensible cache lifecycles (30s stale time). State mutations (e.g., updating model pricing, budgets, alerts, API keys) automatically invalidate query caches on demand without continuous polling loops.

## Scripts

| Command          | Description                      |
|------------------|----------------------------------|
| `npm run dev`    | Start development server         |
| `npm run build`  | Production build                 |
| `npm run start`  | Start production server          |
| `npm run lint`   | Run ESLint                       |
| `npm run test`   | Run tests (Vitest)               |

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Auth:** NextAuth.js v5
- **Styling:** Tailwind CSS
- **Data fetching:** TanStack Query
- **Charts:** Recharts
- **Testing:** Vitest + React Testing Library

## Pages

| Route             | Purpose                                      |
|-------------------|----------------------------------------------|
| `/`               | Dashboard overview + detailed-report export  |
| `/connect`        | Connect wizard — guided agent onboarding     |
| `/traces`         | Trace list and replay/detail viewer          |
| `/logs`           | Structured, trace-correlated log search      |
| `/agents`         | Agent registry, per-agent dashboards         |
| `/mcp`            | Per-MCP-server monitoring (calls, flagged)   |
| `/platforms`      | Platform workflow/node analytics             |
| `/tools`          | Tool calls, RAG retrieval, vector search     |
| `/metrics`        | Time-series observability metrics            |
| `/costs`          | Token/cost analytics + model pricing editor  |
| `/evaluations`    | Datasets, runs, leaderboard, regressions, CI snippet |
| `/security`       | Security incident feed + severity/detector/agent summary |
| `/alerts`         | Alert configuration and history              |
| `/projects`       | Project management                           |
| `/settings/team`  | Team members, invites, RBAC                  |
| `/settings/keys`  | API key management                           |

## License

FSL-1.1-ALv2 (source-available, converts to Apache-2.0 after 2 years) — see [LICENSE](../../LICENSE).
