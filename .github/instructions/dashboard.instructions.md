---
applyTo: "apps/web/**"
description: "Next.js dashboard conventions: auth seam, slot system, collector proxy, component patterns, and the open-core overlay model."
---

# Dashboard Instructions

## Open-Core Overlay Model

The dashboard is published to npm as `@splyntra/dashboard`. The commercial `splyntra-cloud` repo overlays screens onto this package source and runs `next build`. Consequence: changing seam files here requires re-publishing the package before the cloud build picks them up.

## Seam Files (Breaking-Change Surface)

| File | Purpose |
|------|---------|
| `src/lib/auth-extensions.ts` | Auth provider registration, sign-in hooks, onboarding redirect |
| `src/lib/slots.ts` | Nav items, widgets, plan features — UI composition points |
| `src/lib/collector-auth.ts` | Per-request collector key resolution |
| `src/lib/auth-providers.ts` | No-op in open repo; replaced by cloud overlay side-effect import |

**Changing signatures in these files is a breaking change for `splyntra-cloud`.**

## Auth

- Dashboard auth uses `next-auth` with session-based flow
- `collector-auth.ts` resolves the API key for backend calls:
  - Open: reads `SPLYNTRA_API_KEY` env var
  - Cloud overlay: looks up active org's key + attaches `X-Splyntra-Org-Id`
- Dev fallbacks activate ONLY when `NODE_ENV=development` (fail-closed)

## Slot System (`src/lib/slots.ts`)

- `registerNavItem({ href, label, icon })` — adds sidebar navigation
- `registerWidget(position, component)` — injects dashboard widgets
- `navSlotItems()` deduplicates by href — registering the same href twice is a no-op

## Component Patterns

- shadcn/ui primitives in `src/components/ui/`
- Tailwind CSS for styling (config in `tailwind.config.js`)
- Server Components by default; `"use client"` only when needed (hooks, interactivity)
- Data fetching: proxy through collector API, never query ClickHouse/Postgres directly

## Testing

```bash
npx tsc --noEmit    # typecheck
npm test            # vitest
```
