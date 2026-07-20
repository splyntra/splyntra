// SPDX-License-Identifier: FSL-1.1-ALv2
// Active-org + user branding for the sidebar (name/logo/avatar). Fetched rather
// than read from the JWT — the images are data: URLs and must not bloat the token.
"use client";

import { useQuery } from "@tanstack/react-query";

export type Branding = {
  user: { name: string; avatar: string | null };
  org: { name: string; logo: string | null } | null;
};

export function useBranding() {
  return useQuery<Branding>({
    queryKey: ["branding"],
    queryFn: async () => {
      const res = await fetch("/api/branding");
      if (!res.ok) throw new Error("branding");
      return res.json();
    },
    staleTime: 300_000,
    retry: 1,
  });
}
