// SPDX-License-Identifier: AGPL-3.0-only
"use client";
// Reusable client-side table controls: free-text search, sortable columns, and
// pagination — one consistent implementation shared by every data table so they
// behave and look the same. Tables keep their own custom cells/markup; this just
// supplies the filtered+sorted+paged slice plus the header/pagination chrome.
import { useEffect, useMemo, useState, ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from "lucide-react";

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

interface TableControlsOpts<T> {
  /** Returns the searchable text for a row (matched case-insensitively). */
  searchText?: (row: T) => string;
  /** Per-column value accessors used for sorting (string or number). */
  sortAccessors?: Record<string, (row: T) => string | number>;
  initialSort?: SortState;
  pageSize?: number;
}

export interface TableControls<T> {
  q: string;
  setQ: (v: string) => void;
  sort: SortState | null;
  toggleSort: (key: string) => void;
  page: number;
  setPage: (p: number) => void;
  pageCount: number;
  pageSize: number;
  total: number; // rows after filtering (across all pages)
  view: T[]; // the current page's rows
}

export function useTableControls<T>(rows: T[], opts: TableControlsOpts<T> = {}): TableControls<T> {
  const pageSize = opts.pageSize ?? 10;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState | null>(opts.initialSort ?? null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !opts.searchText) return rows;
    return rows.filter((r) => opts.searchText!(r).toLowerCase().includes(s));
  }, [rows, q, opts]);

  const sorted = useMemo(() => {
    const acc = sort && opts.sortAccessors?.[sort.key];
    if (!acc || !sort) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = acc(a);
      const bv = acc(b);
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sort, opts]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clamped = Math.min(page, pageCount - 1);
  const view = sorted.slice(clamped * pageSize, clamped * pageSize + pageSize);

  // Any filter/sort change returns to the first page.
  useEffect(() => setPage(0), [q, sort]);

  function toggleSort(key: string) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  return { q, setQ, sort, toggleSort, page: clamped, setPage, pageCount, pageSize, total: sorted.length, view };
}

/** A clickable, sortable table header cell. */
export function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  className = "",
}: {
  label: ReactNode;
  sortKey: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex select-none items-center gap-1 hover:text-gray-800 dark:hover:text-gray-200 ${align === "right" ? "flex-row-reverse" : ""} ${active ? "text-gray-800 dark:text-gray-200" : ""}`}
      >
        {label}
        {active ? (
          sort!.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

/** Prev/next pagination footer with a range read-out. Hidden when it fits one page. */
export function TablePagination({
  page,
  pageCount,
  pageSize,
  total,
  onPage,
  unit = "row",
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  unit?: string;
}) {
  if (total === 0) return null;
  const start = page * pageSize + 1;
  const end = Math.min(page * pageSize + pageSize, total);
  return (
    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2.5 text-xs text-gray-500 dark:border-gray-800">
      <span className="tabular-nums">
        {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()} {unit}{total === 1 ? "" : "s"}
      </span>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <button
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </button>
          <span className="tabular-nums">Page {page + 1} / {pageCount}</span>
          <button
            disabled={page >= pageCount - 1}
            onClick={() => onPage(page + 1)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
