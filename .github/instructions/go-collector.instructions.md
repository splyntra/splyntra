---
applyTo: "apps/collector/**/*.go"
description: "Go collector conventions: chi router, internal package boundaries, extension seam, auth middleware, and testing patterns."
---

# Go Collector Instructions

## Package Boundaries

- `internal/*` packages are NOT importable by extension modules or external code
- Only `extension/` types are the public API surface for out-of-tree modules
- The `app/app.go` wires the HTTP router: auth middleware → core routes → extension modules

## Extension Seam (apps/collector/extension/)

- `Module` interface mounts extra `/v1` routes on the authenticated group
- `Deps` struct provides: Logger, PostgresDSN, Tenant resolver, WindowCostUSD
- `QuotaGuard` — OSS default allows everything; commercial enforces plan limits
- `TokenValidator` — fires only after api_keys hash lookup misses (perf guard)
- Registration: module calls `Register()` from its `init()`; binary blank-imports it
- **Never expose `internal/*` types through Deps** — that breaks the cross-repo boundary

## Common Patterns

- Router: chi/v5 with subrouters per domain (`/v1/traces`, `/v1/projects`, etc.)
- Middleware stack: rate-limit → auth → tenant resolution → handler
- Error responses: JSON `{"error": "message"}` with appropriate HTTP status
- Context: tenant ID extracted via `tenant.FromContext(ctx)`
- Database: raw `database/sql` with `lib/pq` for Postgres, `clickhouse-go/v2` for ClickHouse

## Testing

```bash
go test -race ./...                    # all packages
go test ./internal/auth/ -run TestName # single test
```

- Table-driven tests with `t.Run()` subtests
- Use `httptest.NewRecorder()` for handler tests
- Mock interfaces, not implementations

## Gotchas

- `QuotaGuard.Allow()` hits the database — keep off hot paths
- NATS/ClickHouse gracefully degrade (Warn log) when unavailable
- Always use `-race` flag in tests
