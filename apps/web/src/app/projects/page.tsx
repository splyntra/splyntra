// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProjects } from "@/lib/hooks";
import { useProject } from "@/lib/project-context";
import { ProjectItem, createProject, updateProject, deleteProject } from "@/lib/api";
import {
  FolderKanban, Plus, Check, X, AlertTriangle, Pencil, Archive, ArchiveRestore, Trash2,
} from "lucide-react";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { useTableControls, TablePagination } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";

const ENV_OPTIONS = [
  { value: "development", label: "development" },
  { value: "staging", label: "staging" },
  { value: "production", label: "production" },
];

const ENV_BADGE: Record<string, string> = {
  production: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  staging: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  development: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};
const INPUT =
  "w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-gray-800";
const ICON_BTN =
  "rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-white disabled:opacity-40";

export default function ProjectsPage() {
  const { data, isLoading, error } = useProjects();
  const { projectId, setProjectId } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("development");
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const all: ProjectItem[] = data?.projects || [];
  const active = all.filter((p) => !p.archived_at);
  const archived = all.filter((p) => p.archived_at);
  const atc = useTableControls(active, { pageSize: 10 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["projects"] });

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setErrMsg("");
    try {
      await createProject({ name: name.trim(), environment });
      setName("");
      setEnvironment("development");
      refresh();
      toast.success("Project created.");
    } catch {
      setErrMsg("Could not create project — an admin-scoped session or API key is required.");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveRename(id: string) {
    if (!editName.trim()) return;
    setBusyId(id);
    try {
      await updateProject(id, { name: editName.trim() });
      setEditingId(null);
      refresh();
      toast.success("Project renamed.");
    } catch {
      toast.error("Couldn’t rename the project.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleArchive(p: ProjectItem) {
    setBusyId(p.id);
    try {
      await updateProject(p.id, { archived: !p.archived_at });
      if (!p.archived_at && projectId === p.id) setProjectId(""); // archiving the active one
      refresh();
      toast.success(p.archived_at ? "Project unarchived." : "Project archived.");
    } catch {
      toast.error("Couldn’t update the project.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(p: ProjectItem) {
    const ok = await confirm({
      title: "Delete project",
      description: (
        <>
          This permanently deletes{" "}
          <span className="font-semibold text-gray-900 dark:text-white">{p.name}</span> and purges all of its
          traces, spans, detections, agents, alerts, and keys. This cannot be undone.
        </>
      ),
      requireText: p.name,
      confirmText: "Delete permanently",
      tone: "danger",
    });
    if (!ok) return;
    setBusyId(p.id);
    try {
      await deleteProject(p.id);
      if (projectId === p.id) setProjectId("");
      refresh();
      toast.success("Project deleted.");
    } catch {
      toast.error("Couldn’t delete the project.");
    } finally {
      setBusyId(null);
    }
  }

  function renderRow(p: ProjectItem, isArchived: boolean) {
    const isActive = projectId === p.id;
    const editing = editingId === p.id;
    return (
      <tr key={p.id} className={`transition-colors ${isActive ? "bg-gray-50 dark:bg-gray-900/60" : "hover:bg-gray-50 dark:hover:bg-gray-900/40"} ${isArchived ? "opacity-70" : ""}`}>
        <td className="px-5 py-3.5">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveRename(p.id); if (e.key === "Escape") setEditingId(null); }}
                className="w-48 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
              <button onClick={() => saveRename(p.id)} disabled={busyId === p.id} className={ICON_BTN} title="Save">
                <Check className="h-4 w-4 text-emerald-600" />
              </button>
              <button onClick={() => setEditingId(null)} className={ICON_BTN} title="Cancel">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {isActive && <span className="h-1.5 w-1.5 rounded-full bg-gray-900 dark:bg-white" />}
              <span className="font-medium text-gray-900 dark:text-white">{p.name}</span>
              {isArchived && (
                <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800">
                  Archived
                </span>
              )}
            </div>
          )}
        </td>
        <td className="px-5 py-3.5 font-mono text-xs text-gray-500">{p.slug}</td>
        <td className="px-5 py-3.5">
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${ENV_BADGE[p.environment] || ENV_BADGE.development}`}>
            {p.environment}
          </span>
        </td>
        <td className="px-5 py-3.5 text-xs text-gray-500">{new Date(p.created_at).toLocaleDateString()}</td>
        <td className="px-5 py-3.5">
          <div className="flex items-center justify-end gap-0.5">
            {!isArchived && (
              <button
                onClick={() => setProjectId(isActive ? "" : p.id)}
                className={`mr-1 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "border border-gray-200 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                {isActive && <Check className="h-3.5 w-3.5" />}
                {isActive ? "Selected" : "Select"}
              </button>
            )}
            {!isArchived && !editing && (
              <button onClick={() => { setEditingId(p.id); setEditName(p.name); }} className={ICON_BTN} title="Rename">
                <Pencil className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => toggleArchive(p)} disabled={busyId === p.id} className={ICON_BTN} title={isArchived ? "Unarchive" : "Archive"}>
              {isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            </button>
            <button
              onClick={() => handleDelete(p)}
              disabled={busyId === p.id}
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/30"
              title="Delete permanently"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  const HEAD = (
    <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
      <tr className="[&>th]:px-5 [&>th]:py-3 [&>th]:text-left [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500">
        <th>Name</th>
        <th>Slug</th>
        <th>Environment</th>
        <th>Created</th>
        <th className="text-right">Actions</th>
      </tr>
    </thead>
  );

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        subtitle="Group traces, agents, costs, and alerts. Select a project to scope the dashboard."
      />

      {error && !isLoading && (
        <Card className="mb-4 flex items-center gap-2 border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Could not load projects — is the collector reachable?
        </Card>
      )}

      {/* Create */}
      <Card className="mb-6 overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50/50 px-5 py-3 dark:border-gray-800 dark:bg-gray-900/50">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Create a project</h3>
        </div>
        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3 p-5">
          <label className="min-w-[220px] flex-1">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Checkout Agent" className={INPUT} />
          </label>
          <label className="min-w-[160px]">
            <span className="mb-1.5 block text-[13px] font-medium text-gray-700 dark:text-gray-300">Environment</span>
            <Select value={environment} onValueChange={setEnvironment} options={ENV_OPTIONS} ariaLabel="Environment" className="w-full" />
          </label>
          <button
            disabled={submitting || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <Plus className="h-4 w-4" />
            {submitting ? "Creating…" : "Create project"}
          </button>
          {errMsg && (
            <p className="flex w-full items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              {errMsg}
            </p>
          )}
        </form>
      </Card>

      {/* Active projects */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">Projects ({active.length})</h2>
        {projectId && (
          <button onClick={() => setProjectId("")} className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-white">
            Clear selection
          </button>
        )}
      </div>
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-4 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
                <div className="ml-auto h-6 w-16 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
              </div>
            ))}
          </div>
        ) : active.length === 0 ? (
          <EmptyState icon={FolderKanban} title="No projects yet">
            Create your first project above to start scoping traces, costs, and alerts.
          </EmptyState>
        ) : (
          <>
            <table className="w-full text-sm">{HEAD}<tbody className="divide-y divide-gray-100 dark:divide-gray-800">{atc.view.map((p) => renderRow(p, false))}</tbody></table>
            <TablePagination page={atc.page} pageCount={atc.pageCount} pageSize={atc.pageSize} total={atc.total} onPage={atc.setPage} onPageSize={atc.setPageSize} unit="project" />
          </>
        )}
      </Card>

      {/* Archived */}
      {archived.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-[13px] font-semibold uppercase tracking-wider text-gray-500">Archived ({archived.length})</h2>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">{HEAD}<tbody className="divide-y divide-gray-100 dark:divide-gray-800">{archived.map((p) => renderRow(p, true))}</tbody></table>
          </Card>
        </>
      )}

    </div>
  );
}
