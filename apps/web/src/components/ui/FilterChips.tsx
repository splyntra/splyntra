// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

export interface ChipOption {
  value: string;
  label: string;
  count?: number;
}

/** A horizontal row of single-select filter chips (e.g. catalog categories). */
export function FilterChips({
  options,
  value,
  onChange,
  className = "",
}: {
  options: ChipOption[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`} role="tablist" aria-label="Filter">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-splyntra-400 ${
              active
                ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900"
                : "border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:text-white"
            }`}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={`tabular-nums ${active ? "text-gray-300 dark:text-gray-500" : "text-gray-400"}`}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
