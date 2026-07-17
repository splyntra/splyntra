// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";
// Fleet-view source-domain filter (All · Agents · Platforms). Keeps the fleet
// observability pages from silently blending agent and platform data. Value ""
// = all; maps directly to the `source` API param.
import { Select } from "@/components/ui/Select";
import { SourceScope } from "@/lib/api";

export function SourceFilter({
  value,
  onChange,
  size = "sm",
  className = "min-w-[140px]",
}: {
  value: "" | SourceScope;
  onChange: (v: "" | SourceScope) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as "" | SourceScope)}
      size={size}
      ariaLabel="Filter by source"
      className={className}
      options={[
        { value: "", label: "All sources" },
        { value: "agent", label: "Agents" },
        { value: "platform", label: "Platforms" },
      ]}
    />
  );
}
