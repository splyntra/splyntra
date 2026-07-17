// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import Image from "next/image";

// Split-screen auth shell: the form lives on the left, a brand/testimonial panel
// on the right (hidden below lg). Monochrome to match the logo — black / silver /
// white / grey. Used by both /login and /signup so they stay identical.
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Left — form */}
      <div className="flex flex-col justify-center bg-white px-6 py-12 dark:bg-zinc-950 sm:px-12 lg:px-16 xl:px-24">
        <div className="mx-auto w-full max-w-sm animate-slide-up">
          <div className="mb-9 flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Splyntra"
              width={48}
              height={48}
              priority
              className="h-12 w-12 rounded-xl"
            />
            <span className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
              Splyntra
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
          ) : null}

          <div className="mt-8">{children}</div>

          {footer ? (
            <div className="mt-6 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
              {footer}
            </div>
          ) : null}
        </div>
      </div>

      {/* Right — testimonial */}
      <div className="relative hidden bg-zinc-950 lg:flex lg:flex-col lg:justify-center">
        {/* subtle silver texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        <a
          href="https://github.com/splyntra/splyntra"
          className="absolute right-8 top-8 z-10 flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          Documentation
        </a>
        <figure className="relative z-10 mx-auto max-w-xl px-16">
          <span className="block font-serif text-7xl leading-none text-zinc-700" aria-hidden>
            &ldquo;
          </span>
          <blockquote className="-mt-6 text-3xl font-medium leading-tight tracking-tight text-white">
            We ship agents faster because Splyntra shows us exactly what every run
            did — and flags the risky ones before they reach a customer.
          </blockquote>
          <figcaption className="mt-8 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-zinc-600 to-zinc-800 text-sm font-semibold text-white">
              AK
            </span>
            <span className="text-sm text-zinc-400">
              <span className="font-medium text-zinc-200">Ava Karim</span> · Head of AI Platform
            </span>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

// Labeled input, monochrome.
export function Field({
  name,
  type,
  label,
  defaultValue,
  autoComplete,
}: {
  name: string;
  type: string;
  label: string;
  defaultValue?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        required
        className="w-full rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-[14px] text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-4 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10"
      />
    </label>
  );
}
