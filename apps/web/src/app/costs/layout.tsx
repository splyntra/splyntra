// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Costs | Splyntra",
  description: "Token spend analytics by model, agent, and project",
};

export default function CostsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
