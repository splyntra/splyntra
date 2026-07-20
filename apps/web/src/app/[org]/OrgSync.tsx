// SPDX-License-Identifier: FSL-1.1-ALv2
// Aligns the JWT's active org with the org in the URL. The tenant layout has
// already membership-verified the slug server-side; if the session is pointing
// at a different org (deep link, org switch via URL), adopt the URL's org the
// same way OrgSwitcher does: update the JWT, drop all per-org query caches, and
// refresh. Renders nothing.
"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

export function OrgSync({ orgId, role, slug }: { orgId: string; role: string; slug: string }) {
  const { data: session, update } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const syncing = useRef(false);

  useEffect(() => {
    const current = (session?.user as { orgId?: string } | undefined)?.orgId;
    if (!current || current === orgId || syncing.current) return;
    syncing.current = true;
    (async () => {
      try {
        await update({ orgId, role, orgSlug: slug });
        queryClient.clear();
        router.refresh();
      } finally {
        syncing.current = false;
      }
    })();
  }, [session, orgId, role, slug, update, queryClient, router]);

  return null;
}
