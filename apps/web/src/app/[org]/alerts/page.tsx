// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAlerts } from "@/lib/hooks";
import { useProject } from "@/lib/project-context";
import { createAlert, updateAlert, deleteAlert, AlertItem, AlertEventItem } from "@/lib/api";
import {
  Bell,
  Mail,
  Webhook,
  MessageSquare,
  ShieldAlert,
  DollarSign,
  Plus,
  Trash2,
  Pencil,
  Power,
  AlertTriangle,
  Clock,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { PageHeader, Card, EmptyState, SeverityBadge } from "@/components/ui/primitives";
import { useTableControls, TablePagination } from "@/components/ui/DataTable";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useOrgHref } from "@/lib/org-path";

const CHANNELS: { id: string; label: string; icon: LucideIcon; color: string }[] = [
  { id: "email", label: "Email", icon: Mail, color: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-400" },
  { id: "slack", label: "Slack", icon: MessageSquare, color: "text-purple-600 bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-900 dark:text-purple-400" },
  { id: "webhook", label: "Webhook", icon: Webhook, color: "text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-900 dark:text-orange-400" },
];

type AlertType = "risk_threshold" | "cost_threshold" | "spend_anomaly";

const ALERT_TYPES: { value: AlertType; label: string; desc: string; icon: LucideIcon }[] = [
  { value: "risk_threshold", label: "Risk Threshold", desc: "Alert when a trace risk score exceeds threshold", icon: ShieldAlert },
  { value: "cost_threshold", label: "Cost Threshold", desc: "Alert when 24h spend exceeds limit", icon: DollarSign },
  { value: "spend_anomaly", label: "Spend Anomaly", desc: "Alert when daily spend spikes above its recent average", icon: Activity },
];

export default function AlertsPage() {
  const oh = useOrgHref();
  const { data, isLoading, isError } = useAlerts();
  const { projectId } = useProject();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const [name, setName] = useState("");
  const [type, setType] = useState<AlertType>("risk_threshold");
  const [threshold, setThreshold] = useState(70);
  const [windowDays, setWindowDays] = useState(7);
  const [factor, setFactor] = useState(3);
  const [channels, setChannels] = useState<string[]>(["email"]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const alerts: AlertItem[] = data?.alerts || [];
  const events: AlertEventItem[] = data?.events || [];
  const etc = useTableControls(events, { pageSize: 10 });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["alerts"] });

  function resetForm() {
    setEditingId(null);
    setName("");
    setType("risk_threshold");
    setThreshold(70);
    setWindowDays(7);
    setFactor(3);
    setChannels(["email"]);
    setWebhookUrl("");
    setSlackWebhookUrl("");
    setEmailTo("");
    setErrMsg("");
  }

  function startEdit(a: AlertItem) {
    const cfg = (a.config || {}) as Record<string, unknown>;
    setEditingId(a.id);
    setName(a.name);
    setType((["risk_threshold", "cost_threshold", "spend_anomaly"].includes(a.type) ? a.type : "risk_threshold") as AlertType);
    setThreshold(typeof cfg.threshold === "number" ? cfg.threshold : 70);
    setWindowDays(typeof cfg.window_days === "number" ? cfg.window_days : 7);
    setFactor(typeof cfg.factor === "number" ? cfg.factor : 3);
    setChannels(a.channels?.length ? a.channels : ["email"]);
    setWebhookUrl(typeof cfg.webhook_url === "string" ? cfg.webhook_url : "");
    setSlackWebhookUrl(typeof cfg.slack_webhook_url === "string" ? cfg.slack_webhook_url : "");
    setEmailTo(typeof cfg.email_to === "string" ? cfg.email_to : "");
    setErrMsg("");
    setShowForm(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrMsg("");
    if (!name.trim()) {
      setErrMsg("Name is required");
      return;
    }
    if (channels.length === 0) {
      setErrMsg("Select at least one channel");
      return;
    }
    setSubmitting(true);
    try {
      const config: Record<string, unknown> = {};
      if (type === "spend_anomaly") {
        config.window_days = windowDays;
        config.factor = factor;
      } else {
        config.threshold = threshold;
        if (type === "cost_threshold") config.window_sec = 86400;
      }
      if (channels.includes("webhook") && webhookUrl.trim()) config.webhook_url = webhookUrl.trim();
      if (channels.includes("slack") && slackWebhookUrl.trim()) config.slack_webhook_url = slackWebhookUrl.trim();
      if (channels.includes("email") && emailTo.trim()) config.email_to = emailTo.trim();
      if (editingId) {
        await updateAlert(editingId, { name: name.trim(), type, config, channels });
      } else {
        await createAlert({ name: name.trim(), type, project_id: projectId || undefined, config, channels });
      }
      const wasEditing = !!editingId;
      resetForm();
      setShowForm(false);
      refresh();
      toast.success(wasEditing ? "Alert updated." : "Alert created.");
    } catch (err: any) {
      setErrMsg(err?.message || (editingId ? "Failed to update alert" : "Failed to create alert"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onToggleActive(a: AlertItem) {
    setTogglingId(a.id);
    try {
      await updateAlert(a.id, { is_active: !a.is_active });
      refresh();
    } catch {
      toast.error(a.is_active ? "Couldn’t pause the alert." : "Couldn’t enable the alert.");
      refresh(); // re-sync card state from the server (roll back the optimistic view)
    } finally {
      setTogglingId(null);
    }
  }

  async function onDelete(id: string) {
    const alert = alerts.find((a) => a.id === id);
    const ok = await confirm({
      title: "Delete this alert?",
      description: alert ? (
        <>
          <span className="font-medium text-gray-700 dark:text-gray-300">{alert.name}</span> will stop firing and
          its configuration will be removed.
        </>
      ) : (
        "This alert will stop firing and its configuration will be removed."
      ),
      confirmText: "Delete alert",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteAlert(id);
      if (editingId === id) {
        resetForm();
        setShowForm(false);
      }
      refresh();
      toast.success("Alert deleted.");
    } catch {
      toast.error("Couldn’t delete the alert.");
    }
  }

  function toggleChannel(ch: string) {
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]));
  }

  return (
    <div className="mx-auto max-w-6xl p-6 lg:p-8">
      <PageHeader
        icon={Bell}
        title="Alerts"
        subtitle="Configure notifications for risk thresholds and cost overruns"
        action={
          <button
            onClick={() => {
              if (showForm) {
                setShowForm(false);
                resetForm();
              } else {
                resetForm();
                setShowForm(true);
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            <Plus className="h-4 w-4" />
            New Alert
          </button>
        }
      />

      {/* Create alert form */}
      {showForm && (
        <Card className="mb-8 animate-slide-up overflow-hidden">
          <div className="border-b border-gray-100 bg-gray-50/50 px-6 py-4 dark:border-gray-800 dark:bg-gray-900/50">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {editingId ? "Edit Alert Rule" : "Create Alert Rule"}
            </h3>
            <p className="mt-0.5 text-[12px] text-gray-500">Define conditions and delivery channels for your alert</p>
          </div>
          <form onSubmit={onSubmit} className="p-6">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Alert name */}
              <div className="md:col-span-2">
                <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300">
                  Alert Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., High-risk agent activity"
                  className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-gray-800"
                />
              </div>

              {/* Alert type selection */}
              <div className="md:col-span-2">
                <label className="mb-2 block text-[13px] font-medium text-gray-700 dark:text-gray-300">
                  Alert Type
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {ALERT_TYPES.map((at) => {
                    const Icon = at.icon;
                    const isSelected = type === at.value;
                    return (
                      <button
                        key={at.value}
                        type="button"
                        onClick={() => setType(at.value)}
                        className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                          isSelected
                            ? "border-gray-900 bg-gray-50 shadow-sm dark:border-white dark:bg-gray-800"
                            : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
                        }`}
                      >
                        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${isSelected ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <div className={`text-sm font-semibold ${isSelected ? "text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"}`}>
                            {at.label}
                          </div>
                          <div className="mt-0.5 text-[12px] text-gray-500">{at.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Threshold (risk/cost) — or anomaly config for spend_anomaly */}
              {type === "spend_anomaly" ? (
                <>
                  <div>
                    <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300">Baseline window (days)</label>
                    <input
                      type="number"
                      min={1}
                      value={windowDays}
                      onChange={(e) => setWindowDays(Number(e.target.value))}
                      className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-gray-800"
                    />
                    <p className="mt-1 text-[11px] text-gray-400">Days of history used for the daily-spend average.</p>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300">Spike factor (× average)</label>
                    <input
                      type="number"
                      min={1.1}
                      step={0.1}
                      value={factor}
                      onChange={(e) => setFactor(Number(e.target.value))}
                      className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-gray-800"
                    />
                    <p className="mt-1 text-[11px] text-gray-400">Fire when a day&rsquo;s spend exceeds {factor}× the average.</p>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300">
                    {type === "cost_threshold" ? "Spend Limit (USD / 24h)" : "Risk Score Threshold"}
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      type="number"
                      min={1}
                      max={type === "risk_threshold" ? 100 : undefined}
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-gray-800"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                      {type === "cost_threshold" ? "USD" : "/ 100"}
                    </span>
                  </div>
                  {type === "risk_threshold" && (
                    <div className="mt-2">
                      <input
                        type="range"
                        min={1}
                        max={100}
                        value={threshold}
                        onChange={(e) => setThreshold(Number(e.target.value))}
                        className="w-full accent-gray-900 dark:accent-white"
                      />
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>Low (1)</span>
                        <span>Critical (100)</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Channels */}
              <div>
                <label className="mb-2 block text-[13px] font-medium text-gray-700 dark:text-gray-300">
                  Notification Channels
                </label>
                <div className="space-y-2">
                  {CHANNELS.map((ch) => {
                    const Icon = ch.icon;
                    const isActive = channels.includes(ch.id);
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => toggleChannel(ch.id)}
                        className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all ${
                          isActive
                            ? ch.color + " border-current/20"
                            : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-750"
                        }`}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        <span className="text-sm font-medium">{ch.label}</span>
                        {isActive && (
                          <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider opacity-70">Active</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Channel destination inputs (shown when channel is active) */}
              {channels.includes("email") && (
                <div className="md:col-span-2">
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300">
                    Email Recipient
                  </label>
                  <input
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="alerts@yourcompany.com (comma-separated for multiple)"
                    className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-gray-800"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">Leave empty to use the account email</p>
                </div>
              )}
              {channels.includes("slack") && (
                <div className="md:col-span-2">
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300">
                    Slack Webhook URL
                  </label>
                  <input
                    value={slackWebhookUrl}
                    onChange={(e) => setSlackWebhookUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/services/T.../B.../..."
                    className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-mono text-[12px] outline-none transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-gray-800"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">
                    Get from Slack → Apps → Incoming Webhooks. Falls back to global ALERT_SLACK_WEBHOOK_URL if empty.
                  </p>
                </div>
              )}
              {channels.includes("webhook") && (
                <div className="md:col-span-2">
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300">
                    Webhook URL
                  </label>
                  <input
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://your-server.com/api/alert-hook"
                    className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-mono text-[12px] outline-none transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-gray-800"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">
                    JSON POST with alert event payload. Falls back to global ALERT_WEBHOOK_URL if empty.
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="mt-6 flex items-center gap-3 border-t border-gray-100 pt-5 dark:border-gray-800">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                {submitting
                  ? editingId
                    ? "Saving…"
                    : "Creating…"
                  : editingId
                    ? "Save changes"
                    : "Create Alert"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              {errMsg && (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-red-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {errMsg}
                </span>
              )}
            </div>
          </form>
        </Card>
      )}

      {/* Active alerts */}
      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">
            Active Rules ({alerts.length})
          </h2>
        </div>

        {isLoading ? (
          <Card className="p-8 text-center text-sm text-gray-500">Loading…</Card>
        ) : isError ? (
          <Card>
            <EmptyState icon={AlertTriangle} title="Couldn’t load alert rules">
              The collector is unavailable — check that it’s reachable, then retry.
            </EmptyState>
          </Card>
        ) : alerts.length === 0 ? (
          <Card>
            <EmptyState icon={Bell} title="No alert rules configured">
              Create your first alert to get notified when risk scores or costs exceed thresholds.
            </EmptyState>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {alerts.map((a) => {
              const isRisk = a.type === "risk_threshold";
              const isAnomaly = a.type === "spend_anomaly";
              const AlertIcon = isRisk ? ShieldAlert : isAnomaly ? Activity : DollarSign;
              const cfg = (a.config || {}) as { threshold?: number; window_days?: number; factor?: number };
              const summary = isRisk
                ? `Risk ≥ ${cfg.threshold}`
                : isAnomaly
                  ? `Spend > ${cfg.factor ?? 3}× ${cfg.window_days ?? 7}-day avg`
                  : `Spend > $${cfg.threshold}/day`;
              const paused = !a.is_active;
              return (
                <Card key={a.id} className={`group relative p-5 transition-opacity ${paused ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${isRisk ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400" : "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"}`}>
                      <AlertIcon className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => onToggleActive(a)}
                        disabled={togglingId === a.id}
                        className={`rounded-lg p-1.5 transition-colors disabled:opacity-50 ${paused ? "text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/30" : "text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"}`}
                        title={paused ? "Enable alert" : "Pause alert"}
                      >
                        <Power className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => startEdit(a)}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                        title="Edit alert"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => onDelete(a.id)}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                        title="Delete alert"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{a.name}</h3>
                    {paused && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        Paused
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] text-gray-500">{summary}</p>
                  <div className="mt-3 flex items-center gap-1.5">
                    {a.channels.map((ch) => {
                      const channel = CHANNELS.find((c) => c.id === ch);
                      if (!channel) return null;
                      const ChIcon = channel.icon;
                      return (
                        <span
                          key={ch}
                          title={channel.label}
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                        >
                          <ChIcon className="h-3.5 w-3.5" />
                        </span>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Alert history */}
      <div>
        <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-gray-500">
          Recent Activity
        </h2>
        <Card className="overflow-hidden">
          {events.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-gray-400">
              <Clock className="h-4 w-4" />
              No alerts have fired yet
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900/50">
                <tr>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Alert</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Trace</th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Risk</th>
                  <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Severity</th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500">Fired</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {etc.view.map((ev) => (
                  <tr key={ev.id} className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-900/50">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <Activity className="h-3.5 w-3.5 text-gray-400" />
                        <span className="font-medium text-gray-900 dark:text-white">{ev.alert_name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {ev.trace_id && ev.trace_id !== "cost" ? (
                        <a
                          href={oh(`/traces/${ev.trace_id}`)}
                          className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 font-mono text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                        >
                          {ev.trace_id.slice(0, 12)}…
                        </a>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                          Cost
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{ev.risk_score}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <SeverityBadge severity={ev.severity} />
                    </td>
                    <td className="px-5 py-3.5 text-right text-[12px] text-gray-500">
                      {new Date(ev.fired_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <TablePagination page={etc.page} pageCount={etc.pageCount} pageSize={etc.pageSize} total={etc.total} onPage={etc.setPage} onPageSize={etc.setPageSize} unit="event" />
        </Card>
      </div>
    </div>
  );
}
