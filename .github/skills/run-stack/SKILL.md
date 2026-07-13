---
name: run-stack
description: "Start, stop, and troubleshoot the full Splyntra development stack. Use when setting up the dev environment, debugging docker compose issues, or verifying the stack is healthy."
---

# Run Stack

## When to Use

- First-time setup of the development environment
- Starting/stopping the full stack or individual services
- Debugging why a service won't start or connect
- Verifying the stack is healthy after changes

## Quick Start

```bash
# Full stack (dashboard :3000 + collector :4318 + all infra)
task dev

# Infrastructure only (postgres, clickhouse, nats, valkey, minio)
task up

# Stop everything
task down
```

## Service Health Check

| Service | Port | Health Check |
|---------|------|-------------|
| Dashboard | 3000 | `curl http://localhost:3000` |
| Collector | 4318 | `curl http://localhost:4318/health` |
| PostgreSQL | 5432 | `pg_isready -h localhost -p 5432` |
| ClickHouse | 8123 | `curl http://localhost:8123/ping` |
| NATS | 4222 | `curl http://localhost:8222/healthz` |
| Valkey | 6379 | `redis-cli -p 6379 ping` |
| MinIO | 9090 | `curl http://localhost:9090/minio/health/live` |

## Common Issues

### Ports already in use
```bash
lsof -i :4318  # Find what's using the port
docker compose down && docker compose up -d  # Restart clean
```

### Migrations not applying
Migrations auto-apply via `docker-entrypoint-initdb.d`. If the DB already exists with stale schema:
```bash
docker compose down -v  # Remove volumes (DESTROYS DATA)
docker compose up -d    # Fresh start with all migrations
```

### Collector can't reach ClickHouse/NATS
These are optional — collector logs `WARN` and continues without them. Check:
```bash
docker compose logs clickhouse
docker compose logs nats
```

### Dashboard auth issues
Dev-key fallback only works when `NODE_ENV=development`. Check `.env`:
```
SPLYNTRA_API_KEY=dev-key-local
NODE_ENV=development
```

## Running Tests Against Stack

```bash
# E2E tests (requires full stack running)
cd tests && pytest test_e2e.py

# Collector integration tests
cd apps/collector && go test -race -tags=integration ./...
```

## Viewing Logs

```bash
task logs                           # All services
docker compose logs -f collector    # Single service
docker compose logs --tail=50 web   # Last 50 lines
```
