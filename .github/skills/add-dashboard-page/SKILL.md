---
name: add-dashboard-page
description: "Scaffold a new page or feature in the Next.js dashboard. Use when adding a new view, settings panel, or data visualization page to the dashboard."
---

# Add Dashboard Page

## When to Use

- Adding a new navigation page to the dashboard
- Creating a new settings/config panel
- Adding a data visualization or analytics view

## Prerequisites

- Working directory: `apps/web/`
- Node 24+ installed
- Next.js 14 App Router knowledge

## Procedure

### 1. Create the Page

Create a new route in the App Router:

```
apps/web/src/app/(dashboard)/<page-name>/page.tsx
```

Use Server Components by default:
```tsx
// SPDX-License-Identifier: AGPL-3.0-only

export default async function PageName() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Page Title</h1>
      {/* content */}
    </div>
  );
}
```

### 2. Add Navigation (if visible in sidebar)

Register a nav item in the appropriate layout or directly if using the slot system:

```tsx
import { NavItem } from "@/components/layout/NavItem";
```

For pages that should appear in both open and commercial builds, add directly. For commercial-only pages, use `registerNavItem()` from `lib/slots.ts` in the cloud overlay.

### 3. Data Fetching

**Always proxy through the collector API** — never query ClickHouse/Postgres directly from the dashboard:

```tsx
import { getCollectorClient } from "@/lib/collector-auth";

async function getData() {
  const client = await getCollectorClient();
  const res = await client.get("/v1/your-endpoint");
  return res.json();
}
```

### 4. Client Components

Only use `"use client"` when necessary (hooks, event handlers, state):

```tsx
"use client";
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
```

### 5. Styling

- Use Tailwind CSS utilities
- Leverage shadcn/ui components from `src/components/ui/`
- Follow existing spacing/layout patterns in sibling pages

### 6. Verify

```bash
cd apps/web
npx tsc --noEmit
npm test
```

## Constraints

- AGPL-3.0 license header on every new file
- Server Components by default, `"use client"` only when needed
- Data always proxied through collector — dashboard never talks to DB directly
- If the page is commercial-only, it belongs in `splyntra-cloud`, not here
