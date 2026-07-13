---
name: add-collector-route
description: "Scaffold a new authenticated API route in the Go collector. Use when adding a new /v1 endpoint with proper middleware, handler, and tests."
---

# Add Collector Route

## When to Use

- Adding a new REST endpoint to the collector's `/v1` group
- Extending the query API with new data access patterns
- Adding a new resource type (CRUD endpoints)

## Prerequisites

- Working directory: `apps/collector/`
- Go 1.22+ installed
- Familiar with chi router patterns

## Procedure

### 1. Create the Handler Package

Create a new file in the appropriate `internal/` package:

```
apps/collector/internal/<domain>/<handler>.go
```

Handler signature pattern:
```go
func HandleGetThing(db *sql.DB) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        tenantID := tenant.FromContext(r.Context())
        // ... implementation
        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(response)
    }
}
```

### 2. Register the Route

In `apps/collector/app/app.go`, mount the route inside the authenticated `/v1` group:

```go
r.Route("/v1", func(r chi.Router) {
    r.Use(authMiddleware)
    // ... existing routes
    r.Get("/things", internal.HandleGetThing(db))
})
```

### 3. Error Response Pattern

Always return JSON errors:
```go
http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
```

### 4. Write Tests

Create `apps/collector/internal/<domain>/<handler>_test.go`:

- Use `httptest.NewRecorder()` and `httptest.NewRequest()`
- Table-driven tests with `t.Run()`
- Test auth rejection (no API key → 401)
- Test tenant isolation (can't access other tenant's data)

### 5. Verify

```bash
cd apps/collector
go vet ./...
go test -race ./internal/<domain>/
```

## Constraints

- Routes live in `internal/` — they are NOT accessible to extension modules
- Always extract tenant ID from context via `tenant.FromContext(ctx)`
- Rate limiting is applied at the middleware layer, not per-handler
- Never expose ClickHouse/Postgres connection handles directly to handlers — use store interfaces
