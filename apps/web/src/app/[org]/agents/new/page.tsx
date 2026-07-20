// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Copy, Bot, ShieldCheck, Bell, Loader2 } from "lucide-react";
import { PageHeader, Card } from "@/components/ui/primitives";
import { Badge } from "@/components/ui/Badge";
import { CatalogIcon } from "@/lib/catalog-icons";
import { useToast } from "@/components/ui/Toast";
import { byCategory, findIntegration, connectCode, GuardMode, Integration } from "@/lib/catalog";
import { createAgent } from "@/lib/api";
import { useOrgHref } from "@/lib/org-path";

type StepId = "basics" | "frameworks" | "providers" | "data" | "security" | "alerts" | "review";
const STEPS: { id: StepId; label: string }[] = [
  { id: "basics", label: "Basics" },
  { id: "frameworks", label: "Frameworks" },
  { id: "providers", label: "LLM Providers" },
  { id: "data", label: "Data & Tools" },
  { id: "security", label: "Security" },
  { id: "alerts", label: "Alerts" },
  { id: "review", label: "Review" },
];

const GUARD_OPTIONS: { value: GuardMode; label: string; desc: string }[] = [
  { value: "off", label: "Off", desc: "Trace only — no inline checks." },
  { value: "monitor", label: "Monitor", desc: "Log injection/secret verdicts; never block." },
  { value: "block", label: "Block", desc: "Block injection & redact secrets before the model call." },
];

function MultiCard({ i, active, onToggle }: { i: Integration; active: boolean; onToggle: () => void }) {
  const planned = i.tier.includes("planned");
  return (
    <button
      type="button"
      onClick={planned ? undefined : onToggle}
      disabled={planned}
      className={`relative flex flex-col rounded-xl border p-3 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-splyntra-400 ${
        planned
          ? "cursor-not-allowed border-gray-200/70 opacity-60 dark:border-gray-800"
          : active
          ? "border-splyntra-400 bg-splyntra-50/40 ring-2 ring-splyntra-100 dark:border-splyntra-500 dark:bg-splyntra-950/20 dark:ring-splyntra-950/50"
          : "border-gray-200/80 hover:border-splyntra-300 dark:border-gray-800 dark:hover:border-splyntra-700"
      }`}
    >
      {active && !planned && (
        <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-splyntra-600 text-white">
          <Check className="h-3 w-3" aria-hidden />
        </span>
      )}
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${active ? "bg-splyntra-100 text-splyntra-600 dark:bg-splyntra-900/50 dark:text-splyntra-300" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>
          <CatalogIcon name={i.icon} />
        </span>
        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{i.name}</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{i.blurb}</p>
      {planned && <span className="mt-1.5"><Badge tone="muted">Planned</Badge></span>}
    </button>
  );
}

export default function NewAgentPage() {
  const oh = useOrgHref();
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [sel, setSel] = useState<Record<string, Set<string>>>({ frameworks: new Set(), providers: new Set(), data: new Set() });
  const [guard, setGuard] = useState<GuardMode>("monitor");
  const [alerts, setAlerts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ agentId: string; apiKey: string } | null>(null);

  const frameworks = useMemo(() => byCategory("framework"), []);
  const providers = useMemo(() => byCategory("provider"), []);
  const dataInts = useMemo(() => [...byCategory("vectordb"), ...byCategory("database"), ...byCategory("mcp")], []);

  const toggle = (group: string, id: string) =>
    setSel((s) => {
      const next = new Set(s[group]);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...s, [group]: next };
    });

  const chosen = (group: string) => [...(sel[group] || [])];
  const stepId = STEPS[step].id;
  const canNext = stepId !== "basics" || name.trim().length > 0;

  // Build the connect payload + snippet from selections.
  const payload = useMemo(() => {
    const fw = chosen("frameworks");
    const pr = chosen("providers");
    const data = chosen("data");
    const vectordbs = data.filter((id) => findIntegration(id)?.category === "vectordb");
    const databases = data.filter((id) => findIntegration(id)?.category === "database");
    const mcp = data.filter((id) => findIntegration(id)?.category === "mcp");
    const instruments = [
      ...fw.map((id) => findIntegration(id)?.instrument).filter(Boolean),
      ...(pr.length ? ["openai"] : []),
      ...vectordbs.map((id) => findIntegration(id)?.instrument).filter(Boolean),
      ...(mcp.length ? ["mcp"] : []),
    ] as string[];
    const providerBaseUrls = pr
      .map((id) => findIntegration(id))
      .filter((i) => i?.baseUrl)
      .map((i) => ({ name: i!.name, url: i!.baseUrl! }));
    return { fw, pr, vectordbs, databases, mcp, instruments, providerBaseUrls };
  }, [sel]);

  const snippet = useMemo(
    () =>
      connectCode({
        agentId: result?.agentId || (name.trim() ? name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "my-agent"),
        apiKey: result?.apiKey,
        instruments: payload.instruments,
        guard,
        providerBaseUrls: payload.providerBaseUrls,
      }),
    [result, name, payload, guard]
  );

  async function create() {
    setBusy(true);
    try {
      const res = await createAgent({
        name: name.trim(),
        frameworks: payload.fw,
        providers: payload.pr,
        vectordbs: payload.vectordbs,
        databases: payload.databases,
        guard_mode: guard,
        alerts_enabled: alerts,
      });
      setResult({ agentId: res.agent_id, apiKey: res.api_key });
      toast.success(`Agent “${res.agent_id}” created — copy the key below, it won’t be shown again.`);
    } catch {
      toast.error("Couldn’t create the agent — an admin session/key is required.");
    } finally {
      setBusy(false);
    }
  }

  const copy = (t: string) => navigator.clipboard?.writeText(t);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href={oh("/agents")} className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Agents
      </Link>
      <PageHeader icon={Bot} title="Connect an agent" subtitle="Pick your stack, set security + alerts, and get a ready-to-paste connect snippet." />

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
        {stepId === "basics" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">Agent name</label>
            <p className="mb-2 text-xs text-gray-500">Used as the agent’s id in traces (e.g. “Billing Assistant” → billing-assistant).</p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Billing Assistant"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400 focus:ring-2 focus:ring-splyntra-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </div>
        )}

        {stepId === "frameworks" && (
          <Grid title="Which agent framework(s) does it use?">
            {frameworks.map((i) => <MultiCard key={i.id} i={i} active={sel.frameworks.has(i.id)} onToggle={() => toggle("frameworks", i.id)} />)}
          </Grid>
        )}
        {stepId === "providers" && (
          <Grid title="Which LLM provider(s)? (cost is tracked per model)">
            {providers.map((i) => <MultiCard key={i.id} i={i} active={sel.providers.has(i.id)} onToggle={() => toggle("providers", i.id)} />)}
          </Grid>
        )}
        {stepId === "data" && (
          <Grid title="Vector DBs, databases & MCP tool servers (optional)">
            {dataInts.map((i) => <MultiCard key={i.id} i={i} active={sel.data.has(i.id)} onToggle={() => toggle("data", i.id)} />)}
          </Grid>
        )}

        {stepId === "security" && (
          <div>
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white"><ShieldCheck className="h-4 w-4 text-splyntra-500" /> Inline guardrail</h3>
            <p className="mb-3 text-xs text-gray-500">Detection always runs after the fact; the guardrail can also act inline (fail-open).</p>
            <div className="space-y-2">
              {GUARD_OPTIONS.map((o) => (
                <label key={o.value} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 ${guard === o.value ? "border-splyntra-400 bg-splyntra-50/40 dark:border-splyntra-500 dark:bg-splyntra-950/20" : "border-gray-200 dark:border-gray-800"}`}>
                  <input type="radio" name="guard" checked={guard === o.value} onChange={() => setGuard(o.value)} className="mt-0.5 h-4 w-4 accent-splyntra-600" />
                  <span className="text-[13px]"><span className="font-medium text-gray-900 dark:text-white">{o.label}</span><span className="mt-0.5 block text-[12px] text-gray-500">{o.desc}</span></span>
                </label>
              ))}
            </div>
          </div>
        )}

        {stepId === "alerts" && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} className="mt-0.5 h-4 w-4 accent-splyntra-600" />
            <span className="text-[13px]"><span className="inline-flex items-center gap-1.5 font-medium text-gray-900 dark:text-white"><Bell className="h-4 w-4 text-splyntra-500" /> Alert on high-risk activity</span>
              <span className="mt-0.5 block text-[12px] text-gray-500">Create an alert rule that fires on HIGH/CRITICAL security detections for this agent.</span></span>
          </label>
        )}

        {stepId === "review" && (
          <div className="space-y-4">
            {!result ? (
              <>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Review</h3>
                <dl className="grid grid-cols-2 gap-3 text-[13px]">
                  <Summary label="Name" value={name || "—"} />
                  <Summary label="Guardrail" value={guard} />
                  <Summary label="Frameworks" value={payload.fw.map((id) => findIntegration(id)?.name).join(", ") || "none"} />
                  <Summary label="Providers" value={payload.pr.map((id) => findIntegration(id)?.name).join(", ") || "none"} />
                  <Summary label="Vector / DB" value={[...payload.vectordbs, ...payload.databases].map((id) => findIntegration(id)?.name).join(", ") || "none"} />
                  <Summary label="MCP" value={payload.mcp.map((id) => findIntegration(id)?.name).join(", ") || "none"} />
                  <Summary label="Alerts" value={alerts ? "enabled" : "disabled"} />
                </dl>
                <button onClick={create} disabled={busy || !name.trim()} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Create agent
                </button>
              </>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-splyntra-200 bg-splyntra-50 p-3 dark:border-splyntra-900 dark:bg-splyntra-950/30">
                  <p className="mb-1.5 text-[11px] font-medium text-splyntra-800 dark:text-splyntra-300">Ingest key — copy it now, it won’t be shown again.</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-[11px] dark:bg-gray-900">{result.apiKey}</code>
                    <button onClick={() => copy(result.apiKey)} className="rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 dark:border-gray-700"><Copy className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Connect code (Python)</h4>
                    <button onClick={() => copy(snippet.python)} className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"><Copy className="h-3.5 w-3.5" /> Copy</button>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[12px] leading-relaxed text-gray-800 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200"><code>{snippet.python}</code></pre>
                </div>
                <Link href={`/agents/${encodeURIComponent(result.agentId)}`} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900">
                  Open agent dashboard <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Nav */}
        {!result && (
          <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-800">
            <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300">
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {stepId !== "review" && (
              <button onClick={() => canNext && setStep((s) => s + 1)} disabled={!canNext} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900">
                Next <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function Grid({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
    </div>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 p-2.5 dark:border-gray-800">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-gray-800 dark:text-gray-200">{value}</dd>
    </div>
  );
}
