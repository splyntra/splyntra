// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { SessionProvider } from "next-auth/react";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ProjectProvider } from "@/lib/project-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchInterval: 10_000,
            retry: 1,
          },
        },
      })
  );

  return (
    <ErrorBoundary>
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <ProjectProvider>{children}</ProjectProvider>
        </QueryClientProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}
