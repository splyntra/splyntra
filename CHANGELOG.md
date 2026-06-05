# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Per-package changelogs (`sdks/python/CHANGELOG.md`, `sdks/typescript/CHANGELOG.md`)
> are generated automatically by release-please from Conventional Commits. This
> root file is the repo-level overview.

## [Unreleased]

### Added
- OTLP-compatible trace collector with authenticated ingestion (Go)
- Python SDK with `@trace_agent`, `@trace_tool`, `@trace_llm` decorators
- TypeScript SDK with class decorators, function wrappers (`wrapAgent`/`wrapTool`/`wrapLLM`), and graceful shutdown
- Framework auto-instrumentation: OpenAI (sync/async/streaming), LangGraph, OpenAI Agents — via `instrument()`
- Redaction-by-default in both SDKs (secrets scrubbed before they leave the process)
- Direct JSON ingest endpoint `POST /v1/events` (nested + flat single-span forms)
- Input validation on ingest (ids, span limits, span type, token sanity) → `400`
- Tenant enrichment + agent registry (framework, first/last seen) in Postgres
- ClickHouse trace/span storage with batch inserts and cost calculation
- NATS JetStream streaming for async processing
- Secret detection (10 patterns: AWS, GitHub, Stripe, OpenAI, JWT, etc.)
- PII detection via Microsoft Presidio
- Prompt injection detection (heuristic + optional ML classifier, labeled BETA)
- Unified trace + risk viewer dashboard (Next.js)
- Cost analytics with per-model **and per-project** breakdown
- Projects page + selector (scopes every view); `GET /v1/projects`
- Alerts: config UI + `risk_threshold` evaluation + email/webhook/Slack delivery + fired history; `GET/POST/DELETE /v1/alerts`
- Agent aggregation and monitoring (with framework labels)
- PostgreSQL-backed API key authentication with SHA-256 hashing
- Docker Compose one-command deployment
- Helm chart for Kubernetes / managed-cloud deployment (`deploy/helm/splyntra`)
- Getting Started + API reference docs; per-SDK READMEs
- Test suites: collector (Go), detectors + SDK redaction (Python), SDK + dashboard (Vitest)
- Automated, lockstep SDK releases via release-please (PyPI + npm)
- Integrations: CrewAI SDK adapter; Dify + n8n webhook ingestion (`/v1/integrations/*`)
- Time-series Metrics (latency p50/p95, throughput, error/success rate, tokens, spend) + dashboard charts; cost_threshold alerts
- Evaluation service: versioned datasets (object storage), scorers (exact/rule/tool-call/latency/cost + LLM-as-judge), regression detection, `splyntra eval` CI gate, dashboard
- Team management: users/memberships/invitations, next-auth login, role-based access (owner/admin/member/viewer) enforced in the BFF
- Governance — Activity Ledger (append-only, hash-chained, verifiable), Delegation (agent permissions, spend limits, approval workflows, `/v1/authorize`), Policy engine (RBAC/ABAC/ReBAC, deny-wins)

### Security
- All inter-service credentials externalized to `.env`
- Internal services on `expose:` only (not published to host)
- Tenant isolation on all query endpoints (org-scoped, even with `?project_id=`)
- Rate limiting on ingestion (configurable RPS)
- Security headers on all HTTP responses
- Redaction-by-default at both the SDK and collector (defence-in-depth)
