// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { ShieldCheck } from "lucide-react";

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-5 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-splyntra-600 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  name,
  type,
  label,
  defaultValue,
}: {
  name: string;
  type: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-gray-600 dark:text-gray-300">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required
        className="w-full rounded-lg border border-gray-200 px-3 py-2 outline-none focus:border-splyntra-400 focus:ring-2 focus:ring-splyntra-100 dark:border-gray-700 dark:bg-gray-800"
      />
    </label>
  );
}
