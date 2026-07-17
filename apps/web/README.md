<p align="center">
  <img src="https://avatars.githubusercontent.com/u/291030557?s=200" alt="Splyntra" width="64" />
</p>

# @splyntra/dashboard

[![npm](https://img.shields.io/npm/v/@splyntra/dashboard)](https://www.npmjs.com/package/@splyntra/dashboard)
[![License](https://img.shields.io/badge/license-FSL--1.1--ALv2-blue.svg)](../../LICENSE)

The Splyntra open dashboard — a composable Next.js application providing trace
visualization, structured logs, agent/MCP/platform metrics, cost analytics,
evaluation results (leaderboard + regression), a security incident feed, alerts,
and team management with RBAC. Every table supports search, sortable columns,
selectable page size, and one-click Excel export.

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
| `NEXTAUTH_SECRET` | —                                | Secret for NextAuth.js session encryption |
| `NEXTAUTH_URL`    | `http://localhost:3000`          | Canonical app URL                   |
| `POSTGRES_DSN`    | —                                | PostgreSQL connection string         |
| `COLLECTOR_URL`   | `http://localhost:4318`          | Splyntra Collector base URL         |
| `EVAL_URL`        | `http://localhost:8002`          | Evaluation service base URL         |
| `SPLYNTRA_API_KEY`| `splyntra_dev_key` (dev only)    | Collector key the dashboard proxies with; dev fallback is rejected outside `development` (fail-closed) |

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
