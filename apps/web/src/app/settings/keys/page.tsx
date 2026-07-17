// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useKeys, useProjects } from "@/lib/hooks";
import { createKey, revokeKey, rotateKey, ApiKeyItem } from "@/lib/api";
import { KeyRound, Copy, Check, RefreshCw, Trash2, ShieldCheck, AlertTriangle } from "lucide-react";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { useTableControls, TablePagination } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";

const SCOPES: { id: "ingest" | "read" | "admin"; label: string; desc: string }[] = [
  { id: "ingest", label: "Ingest", desc: "Send traces & events" },
  { id: "read", label: "Read", desc: "Query traces & metrics" },
  { id: "admin", label: "Admin", desc: "Manage projects & keys" },
];

const INPUT =
  "w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-gray-800";

export default function KeysPage() {
  const { data, isLoading, error } = useKeys();
  const { data: projectsData } = useProjects();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set(["ingest", "read"]));
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const keys: ApiKeyItem[] = data?.keys || [];
  const ktc = useTableControls(keys, { pageSize: 10 });
  const projects = projectsData?.projects || [];
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["keys"] });

  function toggleScope(s: string) {
    setScopes((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setErrMsg("");
    if (scopes.size === 0) {
      setErrMsg("Select at least one scope.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await createKey({ name: name.trim() || "API Key", project_id: projectId || undefined, scopes: [...scopes] });
      setPlaintext(res.key);
      setName("");
      refresh();
      toast.success("API key created — copy the secret now, it won’t be shown again.");
    } catch {
      setErrMsg("Could not create key — an admin-scoped session or key is required.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onRotate(id: string) {
    const ok = await confirm({
      title: "Rotate this key?",
      description: "The current secret stops working immediately. Any client using it must be updated.",
      confirmText: "Rotate key",
    });
    if (!ok) return;
    setErrMsg("");
    setBusyId(id);
    try {
      const res = await rotateKey(id);
      setPlaintext(res.key);
      refresh();
      toast.success("Key rotated — copy the new secret now.");
    } catch {
      setErrMsg("Rotate failed.");
      toast.error("Couldn’t rotate the key.");
    } finally {
      setBusyId(null);
    }
  }

  async function onRevoke(id: string) {
    const ok = await confirm({
      title: "Revoke this key?",
      description: "This cannot be undone. Requests using this key will start failing immediately.",
      confirmText: "Revoke key",
      tone: "danger",
    });
    if (!ok) return;
    setErrMsg("");
    setBusyId(id);
    try {
      await revokeKey(id);
      refresh();
      toast.success("Key revoked.");
    } catch {
      setErrMsg("Revoke failed.");
      toast.error("Couldn’t revoke the key.");
    } finally {
      setBusyId(null);
    }
  }

  function copy() {
    if (!plaintext) return;
    navigator.clipboard.writeText(plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <PageHeader icon={KeyRound} title="API Keys" subtitle="Issue, rotate, and revoke keys used to ingest and query data." />

      {/* One-time secret reveal */}
      {plaintext && (
        <Card className="mb-6 border-gray-900 bg-gray-900 p-5 text-white dark:border-white dark:bg-white dark:text-gray-900">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4" />
            Copy your new key now — it&rsquo;s shown only once.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-black/30 px-3 py-2 font-mono text-xs dark:bg-black/5">{plaintext}</code>
            <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-xs font-medium transition-colors hover:bg-white/25 dark:bg-black/10 dark:hover:bg-black/20">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={() => setPlaintext(null)} className="rounded-lg px-3 py-2 text-xs font-medium opacity-70 transition-opacity hover:opacity-100">
              Dismiss
            </button>
          </div>
        </Card>
      )}

      {/* Create */}
      <Card className="mb-6 overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50/50 px-5 py-3 dark:border-gray-800 dark:bg-gray-900/50">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Create an API key</h3>
        </div>
        <form onSubmit={onCreate} className="space-y-5 p-5">
          <div className="flex flex-wrap gap-4">
            <label className="min-w-[200px] flex-1">
              <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production ingest" className={INPUT} />
            </label>
            <label className="min-w-[180px]">
              <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Scope to project</span>
              <Select
                value={projectId}
                onValueChange={setProjectId}
                ariaLabel="Scope to project"
                options={[{ value: "", label: "Org-wide (all projects)" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
              />
            </label>
          </div>
          <div>
            <span className="mb-2 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Scopes</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {SCOPES.map((s) => {
                const active = scopes.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleScope(s.id)}
                    className={`rounded-xl border-2 p-3 text-left transition-all ${
                      active
                        ? "border-gray-900 bg-gray-50 dark:border-white dark:bg-gray-800"
                        : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-semibold ${active ? "text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"}`}>{s.label}</span>
                      {active && <Check className="h-4 w-4 text-gray-900 dark:text-white" />}
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-500">{s.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              <KeyRound className="h-4 w-4" />
              {submitting ? "Creating…" : "Create key"}
            </button>
            {errMsg && (
              <span className="flex items-center gap-1.5 text-xs text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                {errMsg}
              </span>
            )}
          </div>
        </form>
      </Card>

      {/* List */}
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-gray-500">
        Keys ({keys.length})
      </h2>
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading keys…</div>
        ) : error ? (
          <EmptyState icon={KeyRound} title="Keys unavailable">
            Listing keys requires an admin-scoped session or key.
          </EmptyState>
        ) : keys.length === 0 ? (
          <EmptyState icon={KeyRound} title="No API keys yet">Create one above to start ingesting.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                <tr className="[&>th]:px-5 [&>th]:py-3 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500">
                  <th>Name</th>
                  <th>Key</th>
                  <th>Scope</th>
                  <th>Scopes</th>
                  <th>Last used</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {ktc.view.map((k) => (
                  <tr key={k.id} className={`transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/40 ${k.is_active ? "" : "opacity-60"}`}>
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-gray-900 dark:text-white">{k.name}</div>
                      <div className="text-[11px] text-gray-400">Created {new Date(k.created_at).toLocaleDateString()}</div>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-gray-500">{k.key_prefix}…</td>
                    <td className="px-5 py-3.5 text-xs text-gray-600 dark:text-gray-400">
                      {k.project_id ? projectName(k.project_id) || "project" : "Org-wide"}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {(k.scopes || []).map((s) => (
                          <span key={s} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-500">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${k.is_active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" : "bg-gray-100 text-gray-500 dark:bg-gray-800"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${k.is_active ? "bg-emerald-500" : "bg-gray-400"}`} />
                        {k.is_active ? "Active" : "Revoked"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {k.is_active && (
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => onRotate(k.id)}
                            disabled={busyId === k.id}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                            title="Rotate key"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Rotate
                          </button>
                          <button
                            onClick={() => onRevoke(k.id)}
                            disabled={busyId === k.id}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/30"
                            title="Revoke key"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Revoke
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination page={ktc.page} pageCount={ktc.pageCount} pageSize={ktc.pageSize} total={ktc.total} onPage={ktc.setPage} onPageSize={ktc.setPageSize} unit="key" />
          </div>
        )}
      </Card>
    </div>
  );
}
