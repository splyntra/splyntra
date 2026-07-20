// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Copy, Workflow, Loader2, KeyRound } from "lucide-react";
import { PageHeader, Card } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/Badge";
import { CatalogIcon } from "@/lib/catalog-icons";
import { useToast } from "@/components/ui/Toast";
import { RecipeView } from "@/components/catalog/RecipeView";
import { connectablePlatforms } from "@/lib/platforms";
import { Integration } from "@/lib/catalog";
import { createKey } from "@/lib/api";
import { useProject } from "@/lib/project-context";
import { useOrgHref } from "@/lib/org-path";

// Which payload field carries the workflow name, per platform — shown as a hint.
function workflowFieldHint(id: string): string {
  switch (id) {
    case "dify": return "data.workflow_id";
    case "n8n": return "workflow.name";
    case "bedrock": return "agent_name";
    case "vertex": return "app_name";
    case "openclaw": return "agent";
    default: return "name";
  }
}

type StepId = "platform" | "key" | "connect";
const STEPS: { id: StepId; label: string }[] = [
  { id: "platform", label: "Platform" },
  { id: "key", label: "Ingest key" },
  { id: "connect", label: "Connect" },
];

export default function ConnectPlatformPage() {
  const oh = useOrgHref();
  const toast = useToast();
  const { projectId } = useProject();
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<Integration | null>(null);
  const [workflowName, setWorkflowName] = useState("");
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const platforms = connectablePlatforms();
  const stepId = STEPS[step].id;

  async function mintKey() {
    if (!platform) return;
    setBusy(true);
    try {
      const res = await createKey({
        name: `${platform.name} platform`,
        project_id: projectId || undefined,
        scopes: ["ingest"],
      });
      setApiKey(res.key);
      setStep(2);
      toast.success("Ingest key minted — copy it now, it won’t be shown again.");
    } catch {
      toast.error("Couldn’t mint a key — an admin session/key is required.");
    } finally {
      setBusy(false);
    }
  }

  const copy = (t: string) => navigator.clipboard?.writeText(t);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href={oh("/platforms")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Agent Platforms
      </Link>
      <PageHeader icon={Workflow} title="Connect a platform" subtitle="Pick your orchestrator, mint an ingest key, and get the exact recipe to stream workflow runs into Splyntra." />

      {/* Stepper */}
      <ol className="mb-6 flex flex-wrap gap-x-2 gap-y-1 text-xs">
        {STEPS.map((s, i) => (
          <li key={s.id} className={`inline-flex items-center gap-1.5 ${i === step ? "text-gray-900 dark:text-white" : i < step ? "text-splyntra-600 dark:text-splyntra-300" : "text-gray-400"}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${i === step ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : i < step ? "bg-splyntra-100 text-splyntra-700 dark:bg-splyntra-900/60 dark:text-splyntra-300" : "bg-gray-100 text-gray-400 dark:bg-gray-800"}`}>
              {i < step ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            {s.label}
            {i < STEPS.length - 1 && <span className="mx-1 text-gray-300 dark:text-gray-700">›</span>}
          </li>
        ))}
      </ol>

      <Card className="p-5">
        {stepId === "platform" && (
          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">Which platform are you connecting?</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {platforms.map((p) => {
                const active = platform?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className={`relative flex flex-col rounded-xl border p-3 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-splyntra-400 ${
                      active
                        ? "border-splyntra-400 bg-splyntra-50/40 ring-2 ring-splyntra-100 dark:border-splyntra-500 dark:bg-splyntra-950/20 dark:ring-splyntra-950/50"
                        : "border-gray-200/80 hover:border-splyntra-300 dark:border-gray-800 dark:hover:border-splyntra-700"
                    }`}
                  >
                    {active && (
                      <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-splyntra-600 text-white"><Check className="h-3 w-3" /></span>
                    )}
                    <div className="flex items-center gap-2">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${active ? "bg-splyntra-100 text-splyntra-600 dark:bg-splyntra-900/50 dark:text-splyntra-300" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>
                        <CatalogIcon name={p.icon} />
                      </span>
                      <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{p.name}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{p.blurb}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {stepId === "key" && platform && (
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-splyntra-100 text-splyntra-600 dark:bg-splyntra-900/50 dark:text-splyntra-300"><CatalogIcon name={platform.icon} /></span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Mint an ingest key for {platform.name}</h3>
                <p className="text-[12px] text-gray-500">A scoped <code className="font-mono">ingest</code> key authenticates this platform’s webhook posts / OTLP export.</p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Workflow name <span className="font-normal text-gray-400">(optional)</span></label>
              <p className="mb-2 text-xs text-gray-500">Names the workflow in Splyntra and is pre-filled into the recipe below (the <code className="font-mono">{workflowFieldHint(platform.id)}</code> field). You can also just send it in your payload.</p>
              <input
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder="e.g. Support triage"
                className="w-full max-w-sm rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400 focus:ring-2 focus:ring-splyntra-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <button onClick={mintKey} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Mint ingest key
            </button>
            <p className="text-[12px] text-gray-500">Already have a key? <Link href={oh("/settings/keys")} className="text-splyntra-600 hover:underline">Manage keys</Link>, then skip to the recipe.</p>
          </div>
        )}

        {stepId === "connect" && platform && (
          <div className="space-y-4">
            {apiKey && (
              <div className="rounded-lg border border-splyntra-200 bg-splyntra-50 p-3 dark:border-splyntra-900 dark:bg-splyntra-950/30">
                <p className="mb-1.5 text-[11px] font-medium text-splyntra-800 dark:text-splyntra-300">Ingest key — copy it now, it won’t be shown again.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-[11px] dark:bg-gray-900">{apiKey}</code>
                  <button onClick={() => copy(apiKey)} className="rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 dark:border-gray-700"><Copy className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            )}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"><CatalogIcon name={platform.icon} /></span>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{platform.name} recipe</h3>
                <div className="flex gap-1">{platform.tier.map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}</div>
              </div>
              <RecipeView i={platform} apiKey={apiKey || undefined} workflowName={workflowName} viewHref={`/platforms/${encodeURIComponent(platform.id)}`} />
            </div>
            <Link href={`/platforms/${encodeURIComponent(platform.id)}`} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900">
              Open {platform.name} dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {/* Nav */}
        {stepId !== "connect" && (
          <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-800">
            <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {stepId === "platform" && (
              <button onClick={() => platform && setStep(1)} disabled={!platform} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900">
                Next <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {stepId === "key" && (
              <button onClick={() => setStep(2)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">
                Skip — I have a key <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
