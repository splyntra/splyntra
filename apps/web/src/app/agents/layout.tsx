// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agents | Splyntra",
  description: "Monitor registered AI agents across environments",
};

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
