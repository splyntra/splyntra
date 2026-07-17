// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import Image from "next/image";

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 via-white to-splyntra-50/30 px-4 dark:from-gray-950 dark:via-gray-950 dark:to-splyntra-950/20">
      <div className="w-full max-w-sm animate-slide-up rounded-2xl border border-gray-200/80 bg-white p-8 shadow-lg shadow-gray-200/50 dark:border-gray-800 dark:bg-gray-900 dark:shadow-none">
        <div className="mb-6 flex flex-col items-center gap-3">
          <Image src="/logo.png" alt="Splyntra" width={56} height={56} priority className="h-14 w-14 rounded-2xl shadow-lg shadow-splyntra-500/25" />
          <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">{title}</h1>
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
      <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required
        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-[14px] outline-none transition-all placeholder:text-gray-400 focus:border-splyntra-400 focus:bg-white focus:ring-2 focus:ring-splyntra-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:bg-gray-800 dark:focus:ring-splyntra-900"
      />
    </label>
  );
}
