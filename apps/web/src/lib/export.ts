// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";
// Excel export helpers, shared by every table's Export button and the home
// report. SheetJS is dynamically imported so it only loads when a user exports
// (keeps it out of the initial bundle). A .xlsx opens natively in Excel/Sheets.

/** A column definition: a header label + how to pull a cell value from a row. */
export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

/** One named worksheet for a multi-sheet workbook (the home report). */
export interface ExportSheet<T = Record<string, unknown>> {
  name: string; // sheet tab name (Excel caps at 31 chars — trimmed here)
  columns: ExportColumn<T>[];
  rows: T[];
}

function toAoA<T>(columns: ExportColumn<T>[], rows: T[]): (string | number | boolean)[][] {
  const head = columns.map((c) => c.header);
  const body = rows.map((r) => columns.map((c) => {
    const v = c.value(r);
    return v === null || v === undefined ? "" : (v as string | number | boolean);
  }));
  return [head, ...body];
}

function fitColumns(aoa: (string | number | boolean)[][]): { wch: number }[] {
  const cols = aoa[0]?.length ?? 0;
  return Array.from({ length: cols }, (_, i) => {
    const max = aoa.reduce((m, row) => Math.max(m, String(row[i] ?? "").length), 0);
    return { wch: Math.min(60, Math.max(10, max + 2)) };
  });
}

function stamp(name: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${name}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
}

/** Export a single table's rows to a one-sheet .xlsx. */
export async function exportToExcel<T>(
  baseName: string,
  columns: ExportColumn<T>[],
  rows: T[],
  sheetName = "Data",
): Promise<void> {
  const XLSX = await import("xlsx");
  const aoa = toAoA(columns, rows);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = fitColumns(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, stamp(baseName));
}

/** Export several worksheets into one .xlsx workbook (the home report). */
export async function exportWorkbook(baseName: string, sheets: ExportSheet<any>[]): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const aoa = toAoA(sheet.columns, sheet.rows);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = fitColumns(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(wb, stamp(baseName));
}
