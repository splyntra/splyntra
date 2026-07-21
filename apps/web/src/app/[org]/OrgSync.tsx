// SPDX-License-Identifier: FSL-1.1-ALv2
// Aligns the JWT's active org with the org in the URL, and is the SINGLE owner of
// an org switch: OrgSwitcher (and any deep link) just navigates to /{slug}; this
// reconciles once. The tenant layout has already membership-verified the slug
// server-side, so if the session points at a different org we adopt the URL's org:
// update the JWT, then INVALIDATE per-org queries (not clear()) so React Query
// refetches under the new org while keeping the current data on screen until the
// fresh data lands — a smooth, in-place swap instead of a blank-then-reload
// flicker. Renders nothing.
"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";

export function OrgSync({ orgId, role, slug }: { orgId: string; role: string; slug: string }) {
  const { data: session, update } = useSession();
  const queryClient = useQueryClient();
  const syncing = useRef(false);

  useEffect(() => {
    const current = (session?.user as { orgId?: string } | undefined)?.orgId;
    if (!current || current === orgId || syncing.current) return;
    syncing.current = true;
    (async () => {
      try {
        await update({ orgId, role, orgSlug: slug });
        // Refetch every per-org query under the new org, but keep the prior data
        // visible until the new data arrives (stale-while-revalidate). No clear()
        // (which blanks the whole UI) and no router.refresh() (which re-runs the
        // RSC tree and flashes) — the sidebar + dashboard update in place.
        await queryClient.invalidateQueries();
      } finally {
        syncing.current = false;
      }
    })();
  }, [session, orgId, role, slug, update, queryClient]);

  return null;
}
