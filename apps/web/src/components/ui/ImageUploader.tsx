// SPDX-License-Identifier: FSL-1.1-ALv2
// Avatar/logo uploader: pick an image → resize client-side → hand the data: URL
// to a server action. Reused by profile (avatar) and org settings (logo).
"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "./Avatar";
import { imageToDataUrl } from "@/lib/image";
import { useToast } from "./Toast";

const BTN =
  "rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";

export function ImageUploader({
  name,
  src,
  square = false,
  label = "Upload",
  action,
}: {
  name: string;
  src?: string | null;
  square?: boolean;
  label?: string;
  /** Persists the data: URL (empty string removes). Returns {error} on failure. */
  action: (dataUrl: string) => Promise<{ error?: string } | void>;
}) {
  const toast = useToast();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null | undefined>(src);

  async function persist(dataUrl: string, okMsg: string) {
    setBusy(true);
    try {
      const res = await action(dataUrl);
      if (res && "error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      setPreview(dataUrl || null);
      toast.success(okMsg);
      router.refresh();
    } catch {
      toast.error("Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-selected
    if (!file) return;
    let dataUrl: string;
    try {
      dataUrl = await imageToDataUrl(file);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid image.");
      return;
    }
    void persist(dataUrl, `${label} updated.`);
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name} src={preview} size="lg" square={square} />
      <div className="flex items-center gap-2">
        <input ref={inputRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={BTN}>
          {busy ? "Uploading…" : preview ? "Change" : label}
        </button>
        {preview && (
          <button type="button" disabled={busy} onClick={() => void persist("", `${label} removed.`)} className={BTN}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
