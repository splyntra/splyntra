// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { exportToExcel, ExportColumn } from "@/lib/export";

/** A compact "Export to Excel" button for a table. Exports the given rows
 * (pass the FILTERED/sorted set, not just the visible page) as an .xlsx. */
export function ExportButton<T>({
  rows,
  columns,
  filename,
  sheetName = "Data",
  size = "sm",
  className = "",
}: {
  rows: T[];
  columns: ExportColumn<T>[];
  filename: string;
  sheetName?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const pad = size === "sm" ? "px-2.5 py-1.5" : "px-3 py-2";
  async function run() {
    if (busy || rows.length === 0) return;
    setBusy(true);
    try {
      await exportToExcel(filename, columns, rows, sheetName);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={run}
      disabled={busy || rows.length === 0}
      title={rows.length === 0 ? "Nothing to export" : `Export ${rows.length} row${rows.length === 1 ? "" : "s"} to Excel`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 ${pad} text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 ${className}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      Export
    </button>
  );
}
