// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "Splyntra — Agent Observability & Security",
  description: "Unified observability and security for AI agents",
  // Favicon + apple-touch icon are served from app/icon.png and app/apple-icon.png
  // (Next's metadata file convention) — optimized 64/180px, not the 712KB logo.
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-[var(--background)] antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
