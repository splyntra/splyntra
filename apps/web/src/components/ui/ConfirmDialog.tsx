// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

/**
 * Global confirmation dialog. Mount <ConfirmProvider> once (in Providers); call
 * const confirm = useConfirm() then `await confirm({ title, description, tone })`
 * — it resolves true/false. Replaces native window.confirm() and one-off modals.
 * Supports a `danger` tone (red action) and `requireText` (type-to-confirm) for
 * irreversible deletes. Focus-trapped, ESC / backdrop cancels, restores focus.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: "default" | "danger";
  /** If set, the user must type this exact string to enable the confirm button. */
  requireText?: string;
}

type Resolver = (ok: boolean) => void;
const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: Resolver } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [typed, setTyped] = useState("");
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => setMounted(true), []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    restoreFocus.current = (document.activeElement as HTMLElement) ?? null;
    setTyped("");
    return new Promise<boolean>((resolve) => setState({ opts, resolve }));
  }, []);

  const settle = useCallback(
    (ok: boolean) => {
      state?.resolve(ok);
      setState(null);
      // Return focus to whatever opened the dialog.
      requestAnimationFrame(() => restoreFocus.current?.focus?.());
    },
    [state]
  );

  // Focus the primary control when the dialog opens.
  useEffect(() => {
    if (!state) return;
    const id = requestAnimationFrame(() => {
      (state.opts.requireText ? inputRef.current : confirmBtn.current)?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [state]);

  // ESC to cancel + basic focus trap while open.
  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        settle(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state, settle]);

  const api = useMemo(() => confirm, [confirm]);

  const gateOk = !state?.opts.requireText || typed.trim() === state.opts.requireText;
  const danger = state?.opts.tone === "danger";

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {mounted &&
        state &&
        createPortal(
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) settle(false);
            }}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              aria-describedby={state.opts.description ? "confirm-desc" : undefined}
              className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex items-start gap-3">
                {danger && (
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500 dark:bg-red-950/40">
                    <AlertTriangle className="h-5 w-5" aria-hidden />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 id="confirm-title" className="text-base font-semibold text-gray-900 dark:text-white">
                    {state.opts.title}
                  </h2>
                  {state.opts.description && (
                    <div id="confirm-desc" className="mt-1.5 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                      {state.opts.description}
                    </div>
                  )}
                </div>
              </div>

              {state.opts.requireText && (
                <div className="mt-4">
                  <label className="mb-1 block text-xs text-gray-500">
                    Type <span className="font-mono font-semibold text-gray-700 dark:text-gray-300">{state.opts.requireText}</span> to confirm
                  </label>
                  <input
                    ref={inputRef}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && gateOk) settle(true);
                    }}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-splyntra-500 focus:ring-1 focus:ring-splyntra-500 dark:border-gray-700 dark:bg-gray-800"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              )}

              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => settle(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 outline-none transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-splyntra-400 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  {state.opts.cancelText || "Cancel"}
                </button>
                <button
                  ref={confirmBtn}
                  onClick={() => settle(true)}
                  disabled={!gateOk}
                  className={`rounded-lg px-4 py-2 text-sm font-medium text-white outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
                    danger
                      ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-400"
                      : "bg-splyntra-600 hover:bg-splyntra-700 focus-visible:ring-splyntra-400"
                  }`}
                >
                  {state.opts.confirmText || "Confirm"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}
