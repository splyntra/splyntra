---
name: seam-check
description: "Validate that changes to open-core seam files won't break the commercial splyntra-cloud build. Use when editing extension/extension.go, auth-extensions.ts, slots.ts, collector-auth.ts, or any file in apps/collector/extension/."
---

# Open-Core Seam Check

## When to Use

- After modifying any file in `apps/collector/extension/`
- After changing `apps/web/src/lib/auth-extensions.ts`
- After changing `apps/web/src/lib/slots.ts`
- After changing `apps/web/src/lib/collector-auth.ts`
- Before submitting a PR that touches seam surfaces

## What This Checks

The open-core seam is the boundary between this repo (open) and `splyntra-cloud` (commercial). The commercial repo extends the open core **without** the open core importing it. Changing a seam signature is a breaking change.

## Procedure

### 1. Identify Seam Surface Changes

Check which seam files are modified:

```bash
git diff --name-only HEAD | grep -E "(extension/extension\.go|auth-extensions\.ts|slots\.ts|collector-auth\.ts)"
```

### 2. Go Collector Extension Seam

For changes to `apps/collector/extension/extension.go`:

- Verify `Module` interface signature is unchanged (or additive only)
- Verify `Deps` struct fields are unchanged (additions OK, removals/renames break)
- Verify `QuotaGuard` interface is unchanged
- Verify `TokenValidator` interface is unchanged
- Confirm no `internal/*` types are exposed through `Deps`
- Check `Register()` function signature

### 3. Dashboard Seam

For changes to auth-extensions, slots, or collector-auth:

- Verify exported function signatures haven't changed
- Verify `registerAuthProviders()` / `registerSignInHook()` / `setOnboardingRedirect()` signatures
- Verify `registerNavItem()` / `registerWidget()` / `registerPlanFeaturesProvider()` signatures
- Confirm dev-key fallback still only activates when `NODE_ENV=development`

### 4. Report

Produce a table:

| File | Change Type | Breaking? | Risk |
|------|------------|-----------|------|
| ... | signature change / addition / removal | Yes/No | High/Low |

If any breaking changes are found, flag them clearly and suggest backward-compatible alternatives.

## Key Rule

> The open core NEVER imports from splyntra-cloud. Dependency is strictly one-way (cloud → open).
