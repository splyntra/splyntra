// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Traces | Splyntra",
  description: "View agent execution traces with unified risk scoring",
};

export default function TracesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
