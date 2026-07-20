// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Traces | Splyntra",
  description: "View agent execution traces with unified risk scoring",
};

export default function TracesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
