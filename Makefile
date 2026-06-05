.PHONY: dev up down build test lint clean

# ─── Development ─────────────────────────────────────────────────────

## Start all services locally
up:
	docker compose up -d

## Stop all services
down:
	docker compose down

## Start with rebuild
dev:
	docker compose up -d --build

## View logs
logs:
	docker compose logs -f

# ─── Build ───────────────────────────────────────────────────────────

## Build all containers
build:
	docker compose build

## Build collector only
build-collector:
	cd apps/collector && go build -o ../../bin/collector ./cmd/collector

## Build dashboard
build-web:
	cd apps/web && npm install && npm run build

# ─── Test ────────────────────────────────────────────────────────────

## Run all tests
test: test-collector test-sdk test-sdk-ts test-security test-web

test-collector:
	cd apps/collector && go test ./...

test-sdk:
	cd sdks/python && pip install -e ".[dev]" && pytest

test-sdk-ts:
	cd sdks/typescript && npm install && npx vitest run

test-security:
	cd apps/security && pip install -e ".[dev]" && pytest

test-web:
	cd apps/web && npx tsc --noEmit && npm test

# ─── Lint ────────────────────────────────────────────────────────────

lint: lint-go lint-python lint-ts

lint-go:
	cd apps/collector && go vet ./...

lint-python:
	cd sdks/python && ruff check .
	cd apps/security && ruff check .

lint-ts:
	cd sdks/typescript && npx tsc --noEmit
	cd apps/web && npx tsc --noEmit

# ─── SDK ─────────────────────────────────────────────────────────────

## Install Python SDK in development mode
sdk-install:
	cd sdks/python && pip install -e ".[dev]"

## Build TypeScript SDK
sdk-build-ts:
	cd sdks/typescript && npm install && npm run build

# ─── Database ────────────────────────────────────────────────────────

## Run PostgreSQL migrations
migrate-pg:
	@echo "Migrations auto-applied via docker-entrypoint-initdb.d"

## Run ClickHouse migrations
migrate-ch:
	@echo "Migrations auto-applied via docker-entrypoint-initdb.d"

# ─── Clean ───────────────────────────────────────────────────────────

clean:
	docker compose down -v
	rm -rf bin/
	rm -rf apps/web/.next
	rm -rf sdks/typescript/dist
