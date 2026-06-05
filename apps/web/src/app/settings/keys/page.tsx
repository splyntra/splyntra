// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useKeys, useProjects } from "@/lib/hooks";
import { createKey, revokeKey, rotateKey, ApiKeyItem } from "@/lib/api";
import { KeyRound, Copy, Check } from "lucide-react";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";

export default function KeysPage() {
  const { data, isLoading, error } = useKeys();
  const { data: projectsData } = useProjects();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [scopeIngest, setScopeIngest] = useState(true);
  const [scopeRead, setScopeRead] = useState(true);
  const [scopeAdmin, setScopeAdmin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const keys: ApiKeyItem[] = data?.keys || [];
  const projects = projectsData?.projects || [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["keys"] });

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrMsg("");
    try {
      const scopes = [
        ...(scopeIngest ? ["ingest"] : []),
        ...(scopeRead ? ["read"] : []),
        ...(scopeAdmin ? ["admin"] : []),
      ];
      const res = await createKey({ name: name || "API Key", project_id: projectId || undefined, scopes });
      setPlaintext(res.key);
      setName("");
      refresh();
    } catch {
      setErrMsg("Could not create key — you need an admin-scoped session/key.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onRotate(id: string) {
    setErrMsg("");
    try {
      const res = await rotateKey(id);
      setPlaintext(res.key);
      refresh();
    } catch {
      setErrMsg("Rotate failed.");
    }
  }

  async function onRevoke(id: string) {
    setErrMsg("");
    try {
      await revokeKey(id);
      refresh();
    } catch {
      setErrMsg("Revoke failed.");
    }
  }

  function copy() {
    if (plaintext) {
      navigator.clipboard.writeText(plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader icon={KeyRound} title="API Keys" subtitle="Issue, rotate, and revoke ingestion keys for this organization" />

      {plaintext && (
        <Card className="mb-4 border-emerald-300 bg-emerald-50 p-4 dark:bg-emerald-900/20">
          <p className="mb-2 text-sm font-medium text-emerald-800 dark:text-emerald-200">
            Copy your new key now — it is shown only once.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-white px-3 py-2 font-mono text-xs dark:bg-gray-900">{plaintext}</code>
            <button onClick={copy} className="inline-flex items-center gap-1 rounded-md border px-2 py-2 text-xs hover:bg-white dark:hover:bg-gray-800">
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={() => setPlaintext(null)} className="rounded-md px-2 py-2 text-xs text-gray-500 hover:bg-white dark:hover:bg-gray-800">Dismiss</button>
          </div>
        </Card>
      )}

      <Card className="mb-6 p-4">
        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[180px]">
            <span className="mb-1 block text-xs font-medium text-gray-500">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production ingest"
              className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-800" />
          </label>
          <label className="min-w-[160px]">
            <span className="mb-1 block text-xs font-medium text-gray-500">Project</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-800">
              <option value="">Org-wide</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={scopeIngest} onChange={(e) => setScopeIngest(e.target.checked)} /> ingest</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={scopeRead} onChange={(e) => setScopeRead(e.target.checked)} /> read</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={scopeAdmin} onChange={(e) => setScopeAdmin(e.target.checked)} /> admin</label>
          </div>
          <button disabled={submitting} className="rounded-lg bg-splyntra-600 px-4 py-2 text-sm font-medium text-white hover:bg-splyntra-700 disabled:opacity-50">
            {submitting ? "Creating…" : "Create key"}
          </button>
        </form>
        {errMsg && <p className="mt-2 text-xs text-amber-600">{errMsg}</p>}
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading keys…</div>
        ) : error ? (
          <EmptyState icon={KeyRound} title="Keys unavailable">
            Listing keys requires an admin-scoped session/key.
          </EmptyState>
        ) : keys.length === 0 ? (
          <EmptyState icon={KeyRound} title="No API keys yet">Create one above to start ingesting.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Prefix</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Scopes</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 font-medium">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{k.key_prefix}…</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{(k.scopes || []).join(", ")}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${k.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-500"}`}>
                      {k.is_active ? "active" : "revoked"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {k.is_active && (
                      <>
                        <button onClick={() => onRotate(k.id)} className="mr-3 text-xs text-splyntra-600 hover:underline">Rotate</button>
                        <button onClick={() => onRevoke(k.id)} className="text-xs text-red-600 hover:underline">Revoke</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
