// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProjects } from "@/lib/hooks";
import { useProject } from "@/lib/project-context";
import { ProjectItem, createProject } from "@/lib/api";
import { FolderKanban } from "lucide-react";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";

export default function ProjectsPage() {
  const { data, isLoading, error } = useProjects();
  const { projectId, setProjectId } = useProject();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("development");
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const projects: ProjectItem[] = data?.projects || [];

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrMsg("");
    try {
      await createProject({ name, environment });
      setName("");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch {
      setErrMsg("Could not create project — an admin-scoped session/key is required.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        subtitle="Create and select projects to scope traces, agents, costs, and alerts"
      />
      {error && !isLoading && (
        <p className="-mt-2 mb-4 text-xs text-amber-600">
          Could not load projects — is the collector reachable?
        </p>
      )}

      <Card className="mb-6 p-4">
        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[200px]">
            <span className="mb-1 block text-xs font-medium text-gray-500">New project name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Checkout Agent"
              className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-800" />
          </label>
          <label className="min-w-[150px]">
            <span className="mb-1 block text-xs font-medium text-gray-500">Environment</span>
            <select value={environment} onChange={(e) => setEnvironment(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm dark:bg-gray-800">
              <option value="development">development</option>
              <option value="staging">staging</option>
              <option value="production">production</option>
            </select>
          </label>
          <button disabled={submitting || !name} className="rounded-lg bg-splyntra-600 px-4 py-2 text-sm font-medium text-white hover:bg-splyntra-700 disabled:opacity-50">
            {submitting ? "Creating…" : "Create project"}
          </button>
        </form>
        {errMsg && <p className="mt-2 text-xs text-amber-600">{errMsg}</p>}
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading projects…</div>
        ) : projects.length === 0 ? (
          <EmptyState icon={FolderKanban} title="No projects found">
            Projects are provisioned in the metadata store (see migrations/postgres)
            and created when API keys are issued.
          </EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Slug</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Environment</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Created</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {projects.map((p) => {
                const isActive = projectId === p.id;
                return (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{p.slug}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                        {p.environment}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setProjectId(isActive ? "" : p.id)}
                        className={`px-3 py-1 rounded text-xs font-medium ${
                          isActive
                            ? "bg-splyntra-500 text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {isActive ? "Selected" : "Select"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
