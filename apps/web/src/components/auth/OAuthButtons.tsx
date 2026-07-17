// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useEffect, useState } from "react";
import { getProviders, signIn } from "next-auth/react";

// Renders one button per configured OAuth provider, discovered at runtime via
// next-auth's provider list. The open build configures only Credentials, so
// nothing renders here; the cloud build adds Google/GitHub/Microsoft and they
// appear automatically — one implementation, correct in both repos.
type ProviderInfo = { id: string; name: string; type: string };

function ProviderIcon({ id }: { id: string }) {
  const cls = "h-[18px] w-[18px]";
  if (id === "github") {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden>
        <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-1.7c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" />
      </svg>
    );
  }
  if (id === "google") {
    return (
      <svg viewBox="0 0 24 24" className={cls} aria-hidden>
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 01-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
        <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3 0-5.6-2-6.5-4.8H1.5v3C3.5 21.3 7.4 24 12 24z" />
        <path fill="#FBBC05" d="M5.5 14.4a7.2 7.2 0 010-4.8v-3H1.5a12 12 0 000 10.8l4-3z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.5 2.7 1.5 6.6l4 3C6.4 6.8 9 4.8 12 4.8z" />
      </svg>
    );
  }
  if (id.startsWith("microsoft") || id === "azure-ad") {
    return (
      <svg viewBox="0 0 24 24" className={cls} aria-hidden>
        <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
        <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
        <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
        <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
      </svg>
    );
  }
  // Generic (e.g. SSO)
  return (
    <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

export function OAuthButtons() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    getProviders().then((all) => {
      if (!all) return;
      setProviders(Object.values(all).filter((p) => p.type !== "credentials") as ProviderInfo[]);
    });
  }, []);

  if (providers.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {providers.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => signIn(p.id, { callbackUrl: "/" })}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          <ProviderIcon id={p.id} />
          Continue with {p.name}
        </button>
      ))}
      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-zinc-200 dark:border-zinc-800" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-3 text-xs uppercase tracking-wide text-zinc-400 dark:bg-zinc-950">
            or
          </span>
        </div>
      </div>
    </div>
  );
}
