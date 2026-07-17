// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

/**
 * Global toast notifications. Mount <ToastProvider> once (in Providers); call
 * useToast() anywhere for `toast.success/error/info(message)`. Toasts stack
 * bottom-right, auto-dismiss, are keyboard-dismissible, and announce to screen
 * readers (errors assertively, the rest politely). The cloud overlay composes
 * against this same module, so commercial screens get it for free.
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
import { CheckCircle2, XCircle, Info, X, type LucideIcon } from "lucide-react";

type ToastType = "success" | "error" | "info";
interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const CONFIG: Record<ToastType, { icon: LucideIcon; ring: string; iconColor: string; ms: number }> = {
  success: { icon: CheckCircle2, ring: "ring-emerald-200 dark:ring-emerald-900", iconColor: "text-emerald-500", ms: 4000 },
  error: { icon: XCircle, ring: "ring-red-200 dark:ring-red-900", iconColor: "text-red-500", ms: 6000 },
  info: { icon: Info, ring: "ring-splyntra-200 dark:ring-gray-700", iconColor: "text-splyntra-500", ms: 4500 },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);
  const nextId = useRef(1);

  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type: ToastType, message: string) => {
    const id = nextId.current++;
    // Cap the stack so a burst of errors can't fill the screen.
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <div
            className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
            aria-live="polite"
            aria-relevant="additions"
          >
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onClose={dismiss} />
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
  const { icon: Icon, ring, iconColor, ms } = CONFIG[toast.type];
  const [visible, setVisible] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const close = useCallback(() => {
    setVisible(false);
    closeTimer.current = setTimeout(() => onClose(toast.id), 180); // let the exit transition run
  }, [onClose, toast.id]);

  useEffect(() => {
    const enter = requestAnimationFrame(() => setVisible(true));
    const auto = setTimeout(close, ms);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(auto);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [close, ms]);

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border border-gray-200/80 bg-white p-3.5 shadow-lg ring-1 ${ring} transition-all duration-200 ease-out motion-reduce:transition-none dark:border-gray-800 dark:bg-gray-900 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} aria-hidden />
      <p className="min-w-0 flex-1 break-words text-[13px] leading-snug text-gray-700 dark:text-gray-200">
        {toast.message}
      </p>
      <button
        onClick={close}
        aria-label="Dismiss notification"
        className="-m-1 rounded-md p-1 text-gray-400 outline-none transition-colors hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-splyntra-400 dark:hover:text-gray-200"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
