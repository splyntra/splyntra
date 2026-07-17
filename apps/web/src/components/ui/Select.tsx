// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

/**
 * Themed <select> replacement. The native option popup is OS-rendered and can't
 * be styled, so this is a custom listbox that matches the app's palette in light
 * and dark mode. Accessible (WAI-ARIA listbox: keyboard nav, type-ahead, focus
 * management), portal-rendered with viewport flip so it never clips inside a
 * scrolling card/table. Shared by the cloud overlay via the @/ alias.
 *
 * Controlled:   <Select value={v} onValueChange={setV} options={...} />
 * In a <form>:  <Select name="role" defaultValue="member" options={...} />  (emits a hidden input)
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Coords {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  options,
  name,
  placeholder = "Select…",
  disabled = false,
  size = "md",
  className = "",
  ariaLabel,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const current = isControlled ? (value as string) : internal;

  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [mounted, setMounted] = useState(false);

  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ buf: "", at: 0 });
  const listId = `select-${useId()}`;

  useEffect(() => setMounted(true), []);

  const selected = options.find((o) => o.value === current);

  const position = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < 260 && r.top > spaceBelow;
    setCoords({
      left: r.left,
      width: r.width,
      ...(flipUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    position();
    setOpen(true);
    const i = options.findIndex((o) => o.value === current);
    setActiveIdx(i >= 0 ? i : 0);
  }, [disabled, position, options, current]);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIdx(-1);
  }, []);

  const choose = useCallback(
    (v: string) => {
      if (!isControlled) setInternal(v);
      onValueChange?.(v);
      close();
      btnRef.current?.focus();
    },
    [isControlled, onValueChange, close]
  );

  // Reposition on scroll/resize, close on outside pointer-down, while open.
  useEffect(() => {
    if (!open) return;
    const reposition = () => position();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || listRef.current?.contains(t)) return;
      close();
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, position, close]);

  // Keep the active option focused for screen-reader + keyboard use.
  useEffect(() => {
    if (!open || activeIdx < 0) return;
    const el = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[activeIdx];
    el?.focus();
  }, [open, activeIdx]);

  function onTriggerKey(e: React.KeyboardEvent) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openMenu();
    }
  }

  function onListKey(e: React.KeyboardEvent) {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close();
        btnRef.current?.focus();
        break;
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIdx(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIdx(options.length - 1);
        break;
      case "Enter":
      case " ": {
        e.preventDefault();
        const o = options[activeIdx];
        if (o && !o.disabled) choose(o.value);
        break;
      }
      case "Tab":
        close();
        break;
      default:
        // Type-ahead: jump to the next option starting with the typed letters.
        if (e.key.length === 1) {
          const now = Date.now();
          typeahead.current.buf = now - typeahead.current.at > 600 ? e.key : typeahead.current.buf + e.key;
          typeahead.current.at = now;
          const q = typeahead.current.buf.toLowerCase();
          const idx = options.findIndex((o) => o.label.toLowerCase().startsWith(q));
          if (idx >= 0) setActiveIdx(idx);
        }
    }
  }

  const pad = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm";

  return (
    <div className={className}>
      {name && <input type="hidden" name={name} value={current} />}
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white text-left outline-none transition-colors hover:border-gray-300 focus-visible:border-gray-400 focus-visible:ring-2 focus-visible:ring-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600 dark:focus-visible:ring-gray-800 ${pad}`}
      >
        <span className={`truncate ${selected ? "text-gray-900 dark:text-white" : "text-gray-400"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      </button>

      {mounted &&
        open &&
        coords &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            id={listId}
            tabIndex={-1}
            onKeyDown={onListKey}
            style={{
              position: "fixed",
              left: coords.left,
              minWidth: coords.width,
              ...(coords.top !== undefined ? { top: coords.top } : { bottom: coords.bottom }),
            }}
            className="z-[120] max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white p-1 shadow-xl dark:border-gray-700 dark:bg-gray-900"
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === current}
                aria-disabled={o.disabled || undefined}
                tabIndex={-1}
                onClick={() => !o.disabled && choose(o.value)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex cursor-pointer select-none items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none ${
                  o.disabled ? "cursor-not-allowed opacity-40" : ""
                } ${i === activeIdx ? "bg-gray-100 dark:bg-gray-800" : ""} ${
                  o.value === current ? "font-medium text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-300"
                }`}
              >
                <span className="truncate">{o.label}</span>
                {o.value === current && <Check className="h-4 w-4 shrink-0 text-gray-900 dark:text-white" aria-hidden />}
              </li>
            ))}
          </ul>,
          document.body
        )}
    </div>
  );
}
