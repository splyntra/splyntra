// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAlerts } from "@/lib/hooks";
import { useProject } from "@/lib/project-context";
import { createAlert, deleteAlert, AlertItem, AlertEventItem } from "@/lib/api";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/ui/primitives";

const CHANNELS = ["email", "webhook", "slack"];

export default function AlertsPage() {
  const { data, isLoading } = useAlerts();
  const { projectId } = useProject();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [type, setType] = useState<"risk_threshold" | "cost_threshold">("risk_threshold");
  const [threshold, setThreshold] = useState(70);
  const [channels, setChannels] = useState<string[]>(["email"]);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const alerts: AlertItem[] = data?.alerts || [];
  const events: AlertEventItem[] = data?.events || [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["alerts"] });

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setErrMsg("");
    if (!name.trim()) {
      setErrMsg("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      await createAlert({
        name: name.trim(),
        type,
        project_id: projectId || undefined,
        config: type === "cost_threshold" ? { threshold, window_sec: 86400 } : { threshold },
        channels,
      });
      setName("");
      setType("risk_threshold");
      setThreshold(70);
      setChannels(["email"]);
      refresh();
    } catch (err: any) {
      setErrMsg(err?.message || "Failed to create alert");
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(id: string) {
    await deleteAlert(id);
    refresh();
  }

  function toggleChannel(ch: string) {
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]));
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageHeader
        icon={Bell}
        title="Alerts"
        subtitle="Fire a notification when a trace's risk score crosses a threshold"
      />

      {/* Create form */}
      <form
        onSubmit={onCreate}
        className="bg-white dark:bg-gray-900 rounded-lg border p-4 mb-6 grid gap-3 md:grid-cols-4"
      >
        <label className="flex flex-col text-sm md:col-span-2">
          <span className="text-xs text-gray-500 mb-1">Alert name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="High-risk traces"
            className="rounded-md border px-2 py-1.5 bg-white dark:bg-gray-800"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-xs text-gray-500 mb-1">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "risk_threshold" | "cost_threshold")}
            className="rounded-md border px-2 py-1.5 bg-white dark:bg-gray-800"
          >
            <option value="risk_threshold">Risk threshold</option>
            <option value="cost_threshold">Cost threshold (24h $)</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-xs text-gray-500 mb-1">
            {type === "cost_threshold" ? "Spend limit (USD / 24h)" : "Risk threshold (0–100)"}
          </span>
          <input
            type="number"
            min={1}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="rounded-md border px-2 py-1.5 bg-white dark:bg-gray-800"
          />
        </label>
        <div className="flex flex-col text-sm">
          <span className="text-xs text-gray-500 mb-1">Channels</span>
          <div className="flex gap-2 flex-wrap items-center h-full">
            {CHANNELS.map((ch) => (
              <label key={ch} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={channels.includes(ch)}
                  onChange={() => toggleChannel(ch)}
                />
                {ch}
              </label>
            ))}
          </div>
        </div>
        <div className="md:col-span-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-md bg-splyntra-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create alert"}
          </button>
          {errMsg && <span className="text-xs text-red-600">{errMsg}</span>}
        </div>
      </form>

      {/* Configured alerts */}
      <h2 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
        Configured alerts
      </h2>
      <div className="bg-white dark:bg-gray-900 rounded-lg border overflow-hidden mb-8">
        {isLoading ? (
          <div className="p-6 text-center text-gray-500">Loading…</div>
        ) : alerts.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No alerts configured yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Type</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Threshold</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Channels</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {alerts.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{a.type}</td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {String((a.config as { threshold?: number })?.threshold ?? "—")}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{a.channels.join(", ")}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => onDelete(a.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Fired history */}
      <h2 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
        Triggered alerts
      </h2>
      <div className="bg-white dark:bg-gray-900 rounded-lg border overflow-hidden">
        {events.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No alerts have fired yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Alert</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Trace</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Risk</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Severity</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Fired</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {events.map((ev) => (
                <tr key={ev.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 font-medium">{ev.alert_name}</td>
                  <td className="px-4 py-3">
                    <a
                      href={`/traces/${ev.trace_id}`}
                      className="font-mono text-xs text-splyntra-600 hover:underline"
                    >
                      {ev.trace_id}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{ev.risk_score}</td>
                  <td className="px-4 py-3 text-xs">{ev.severity}</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">
                    {new Date(ev.fired_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
