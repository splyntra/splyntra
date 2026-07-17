// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

/**
 * A submit button that asks for confirmation before submitting its form. Lets a
 * Server Component keep its progressive-enhancement <form action={serverAction}>
 * while still gating destructive submits behind the global confirm dialog.
 */

import { useRef, type ReactNode } from "react";
import { useConfirm, type ConfirmOptions } from "./ConfirmDialog";

export function ConfirmSubmitButton({
  confirm: opts,
  className,
  title,
  children,
}: {
  confirm: ConfirmOptions;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const confirm = useConfirm();
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={ref}
      type="submit"
      title={title}
      className={className}
      onClick={async (e) => {
        e.preventDefault(); // hold the submit until the user confirms
        if (await confirm(opts)) ref.current?.form?.requestSubmit();
      }}
    >
      {children}
    </button>
  );
}
