// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";
import { Compass, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800">
        <Compass className="h-7 w-7" />
      </div>
      <div className="text-5xl font-bold tracking-tight text-gray-200 dark:text-gray-700">404</div>
      <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">Page not found</h2>
      <p className="mb-6 mt-1 text-gray-500">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-lg bg-splyntra-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-splyntra-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>
    </div>
  );
}
