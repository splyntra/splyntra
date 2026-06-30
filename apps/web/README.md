# @splyntra/dashboard

[![npm](https://img.shields.io/npm/v/@splyntra/dashboard)](https://www.npmjs.com/package/@splyntra/dashboard)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](../../LICENSE)

The Splyntra open dashboard — a composable Next.js application providing trace visualization, agent metrics, cost analytics, evaluation results, alerts, and team management with RBAC.

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
| `/`               | Dashboard overview                           |
| `/traces`         | Trace list and detail viewer                 |
| `/agents`         | Agent registry and status                    |
| `/metrics`        | Time-series observability metrics            |
| `/costs`          | Token and cost analytics                     |
| `/evaluations`    | Evaluation runs and regression results       |
| `/alerts`         | Alert configuration and history              |
| `/projects`       | Project management                           |
| `/settings/team`  | Team members, invites, RBAC                  |
| `/settings/keys`  | API key management                           |

## License

AGPL-3.0 — see [LICENSE](../../LICENSE).
