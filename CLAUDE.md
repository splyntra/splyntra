# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Splyntra is unified observability + security for AI agents. This is the **open core** (`splyntra/splyntra`): the collector, dashboard, detectors, evaluation/security services, and SDKs. A separate **private repo `splyntra-cloud`** holds the commercial edition (governance, identity/SSO, control plane, billing, advanced detectors) and depends on this repo one-way — see "Open-core seam" below. Never add a dependency from the open core onto anything commercial.

Tri-license split (enforced in CI): server core / detectors / dashboard are **FSL-1.1-ALv2** (Functional Source License — source-available, free for internal/production use but no Competing Use; each release converts to Apache-2.0 after two years); SDKs (`sdks/*`) and connectors (`integrations/*`) are **Apache-2.0**; commercial features live only in `splyntra-cloud`. New files carry an SPDX header matching their area (`FSL-1.1-ALv2` for core, `Apache-2.0` for SDKs/integrations).

## Commands

`task` (Taskfile.yml) is the primary runner; `make` mirrors the common targets.

```bash
task dev                 # full stack via docker compose (dashboard :3000, collector OTLP :4318)
task up                  # infra only (postgres, clickhouse, nats, valkey, minio)
task test                # all suites (go + python + ts + web)
task lint                # vet + ruff + tsc across all languages
task build:collector     # Go binary → bin/collector
task fmt                 # gofmt + ruff format
```

Per-language (run from the listed dir — each is its own module/package):

```bash
# Go collector  (apps/collector)
go test -race ./...
go test ./internal/<pkg>/ -run <TestName>        # single package / test
go vet ./...

# Python SDK (sdks/python), security (apps/security), evaluation (apps/evaluation)
pip install -e ".[dev]" && pytest
pytest <path/to/test_file.py>::<test_name>       # single test
ruff check .

# TypeScript SDK (sdks/typescript)
npx vitest run                # all;  npx vitest run <file>  for one
npx tsc --noEmit

# Dashboard (apps/web) — typecheck is part of the gate
npx tsc --noEmit && npm test
```

Migrations are applied automatically by the Postgres/ClickHouse containers via `docker-entrypoint-initdb.d` (files in `migrations/{postgres,clickhouse}`); there is no separate migrate step in local dev.

## Architecture

### Data pipeline
SDK (`sdks/python`, `sdks/typescript`) emits OTLP spans → **collector** (`apps/collector`, Go, OTLP on :4318) authenticates by API key, redacts sensitive data, runs detectors, and writes **traces/metrics to ClickHouse** and **projects/keys/team/alerts to Postgres**. NATS, Valkey, and MinIO back streaming, caching, and blob storage. The Next.js **dashboard** (`apps/web`) never talks to ClickHouse/Postgres for trace data directly — it proxies through the collector. `apps/security` and `apps/evaluation` are Python services (detectors / scorers + eval runs).

The collector's HTTP wiring is in [apps/collector/app/app.go](apps/collector/app/app.go): the authenticated `/v1` group runs auth middleware, then mounts core ingest/query routes, then registered extension modules. Internal packages (`internal/ingest`, `auth`, `redact`, `store`, `tenant`, `alerts`, `streaming`, `validate`, `notify`) are not importable by out-of-tree modules — only the `extension` package's public types are.

### Open-core seam (the central design constraint)
The commercial repo extends the open core **without the open core importing it**. Two mechanisms:

- **Collector (Go):** [apps/collector/extension/extension.go](apps/collector/extension/extension.go) defines `Module` (mounts extra `/v1` routes), `QuotaGuard` (plan enforcement; OSS default allows everything), and `Deps` (the only surface a module gets — `Logger`, `PostgresDSN`, a `Tenant(*http.Request)` projection, `WindowCostUSD`). A commercial module `Register()`s itself from an `init()`; a separate binary blank-imports it. The OSS binary imports nothing, so those routes simply don't exist in it. **Deps never exposes an `internal/*` type** — that's what lets a module live in another repo.
- **Dashboard (web):** [apps/web/src/lib/auth-extensions.ts](apps/web/src/lib/auth-extensions.ts) and `lib/slots.ts` are registration seams. `auth.ts` imports `lib/auth-providers` (a no-op in this repo, **replaced by the cloud overlay**) for side effects, then reads the registered providers / sign-in hooks. `lib/collector-auth.ts` resolves the per-request collector key: the open default is the env `SPLYNTRA_API_KEY`; the cloud overlay registers a resolver that looks up the active org's key and attaches `X-Splyntra-Org-Id`. Dev-key/dev-secret fallbacks activate **only** when `NODE_ENV`/`ENV` is explicitly `development` (fail-closed in prod).

When editing seam files (`extension/`, `auth-extensions.ts`, `slots.ts`, `collector-auth.ts`, `auth.ts`), remember the cloud overlay composes against them. Changing a seam signature is a breaking change for `splyntra-cloud` and requires re-publishing the consumed artifact (see below).

### Dashboard as a published package
`apps/web` is published to npm as **`@splyntra/dashboard`** and consumed by `splyntra-cloud`'s `cloud-web`, which overlays commercial screens onto the package source and runs `next build`. Consequence: a fix to the open dashboard's auth/seam code only reaches the cloud production build after the package is re-published (release-please cuts the version from a `fix:`/`feat:` commit) and the cloud lockfile is bumped. Verifying a seam change end-to-end means building the cloud overlay against the **published** package, not just a local sibling checkout.

## Conventions

- **Conventional Commits** drive **release-please** automated releases (`release-please-config.json`). Commit messages are the changelog and version source.
- **Redact by default**: sensitive data is stripped before storage; redaction lives in the collector (`internal/redact`) and the SDKs, not bolted on later.
- OTel-native — spans are OpenTelemetry, not a proprietary format. Don't introduce a parallel ingest format.
- Contributions require the CLA ([CLA.md](CLA.md)); security issues go through [SECURITY.md](SECURITY.md), not public issues.
