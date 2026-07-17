# AGENTS.md — AI Coding Agent Configuration

> Context for Codex, Copilot, and other AI agents. See also [CLAUDE.md](CLAUDE.md) for Claude Code specifics.

## Quick Reference

| Action | Command |
|--------|---------|
| Full dev stack | `task dev` (dashboard :3000, collector :4318) |
| Infra only | `task up` (postgres, clickhouse, nats, valkey, minio) |
| All tests | `task test` |
| All linters | `task lint` |
| Format | `task fmt` |
| Build collector | `task build:collector` |

Per-language commands (run from listed dir):

```bash
# Go (apps/collector)
go test -race ./...
go vet ./...

# Python (sdks/python, apps/security, apps/evaluation)
pip install -e ".[dev]" && pytest
ruff check . && ruff format --check .

# TypeScript SDK (sdks/typescript)
npx vitest run && npx tsc --noEmit

# Dashboard (apps/web)
npx tsc --noEmit && npm test
```

## Architecture

Splyntra is unified observability + security for AI agents (open core monorepo).

**Data flow**: SDK → OTLP spans → Collector (Go, :4318) → ClickHouse (traces) + Postgres (metadata) → Dashboard (Next.js, :3000)

| Path | Lang | Purpose |
|------|------|---------|
| `apps/collector/` | Go | OTLP ingest, auth, redaction, detectors, query API |
| `apps/web/` | TS/Next.js | Dashboard UI (published as `@splyntra/dashboard`) |
| `apps/security/` | Python | Security detector service |
| `apps/evaluation/` | Python | Eval/scoring service |
| `sdks/python/` | Python | Python instrumentation SDK (Apache-2.0) |
| `sdks/typescript/` | TS | TypeScript instrumentation SDK (Apache-2.0) |
| `migrations/` | SQL | Postgres + ClickHouse schemas (auto-applied in Docker) |
| `integrations/` | Mixed | Third-party platform adapters |

## Critical Constraints

1. **Open-core boundary**: NEVER import from `splyntra-cloud`. Dependency is strictly one-way (cloud → open).
2. **Seam files are breaking-change surface**: Changes to `apps/collector/extension/extension.go`, `apps/web/src/lib/auth-extensions.ts`, `slots.ts`, or `collector-auth.ts` can break the commercial build.
3. **`internal/` is private**: Extension modules can only use types from `apps/collector/extension/` — never `internal/*`.
4. **OTel-native**: All traces are OpenTelemetry spans. No proprietary ingest format.
5. **Redact by default**: Sensitive data stripped before storage (collector `internal/redact` + SDKs).
6. **Fail-closed auth in prod**: Dev-key fallbacks activate ONLY when `NODE_ENV=development`.

## Conventions

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) — drives release-please. Messages ARE the changelog.
- **License headers**: SPDX on every new file. FSL-1.1-ALv2 for server/dashboard/detectors, Apache-2.0 for SDKs and integrations. See [LICENSING.md](LICENSING.md).
- **Migrations**: Auto-applied by Docker via `entrypoint-initdb.d`. No separate migrate step locally.
- **Go module**: Each service is its own module (`github.com/splyntra/splyntra/apps/collector`).
- **Versions**: Go 1.22+, Python 3.12+, Node 24+, TypeScript 5.x (strict).

## PR Expectations

- Tests for new behaviour
- SPDX license headers on new files
- No secrets or credentials committed
- Passing CI: lint + test + typecheck (see `.github/workflows/`)

## Further Reading

- [CONTRIBUTING.md](CONTRIBUTING.md) — Dev setup, workflow, commit format
- [CLAUDE.md](CLAUDE.md) — Deep architecture, seam explanations, per-language details
- [docs/API.md](docs/API.md) — API reference
- [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) — User onboarding
- [SECURITY.md](SECURITY.md) — Vulnerability reporting
