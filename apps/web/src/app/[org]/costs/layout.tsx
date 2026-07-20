// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Costs | Splyntra",
  description: "Token spend analytics by model, agent, and project",
};

export default function CostsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
