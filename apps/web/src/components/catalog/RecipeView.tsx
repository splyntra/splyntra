// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";
// The full webhook/OTLP connect recipe for a platform integration: OTLP note,
// numbered setup steps, the webhook URL, a sample payload, a ready-to-run cURL,
// and a live "Test connection" button. Shared by the catalog drawer and the
// platform connect wizard — the wizard passes the freshly-minted `apiKey` so the
// cURL is copy-paste runnable.
import { useState } from "react";
import Link from "next/link";
import { Play, Loader2, Check, ArrowUpRight } from "lucide-react";
import { CopyButton } from "@/components/ui/CopyButton";
import { useToast } from "@/components/ui/Toast";
import { Integration, webhookUrl, ingestBaseUrl, platformRecipe, testIntegration, withWorkflowName } from "@/lib/catalog";
import { useOrgHref } from "@/lib/org-path";

export function RecipeView({ i, apiKey, viewHref = "/traces", workflowName }: { i: Integration; apiKey?: string; viewHref?: string; workflowName?: string }) {
  const oh = useOrgHref();
  const toast = useToast();
  const [testing, setTesting] = useState(false);
  const [trace, setTrace] = useState<string | null>(null);

  const url = webhookUrl(i.webhook || i.id);
  const recipe = platformRecipe(i.webhook || i.id);
  // Reflect the user's workflow name into the shown payload/cURL when provided.
  const payload = recipe ? withWorkflowName(i.webhook || i.id, recipe.payload, workflowName || "") : undefined;
  const payloadJSON = payload ? JSON.stringify(payload, null, 2) : "";
  const keyToken = apiKey || "<your-ingest-key>";
  const curl =
    `curl -X POST ${url} \\\n` +
    `  -H "Authorization: Bearer ${keyToken}" \\\n` +
    `  -H "Content-Type: application/json" \\\n` +
    `  -d '${payload ? JSON.stringify(payload) : "{}"}'`;

  async function runTest() {
    setTesting(true);
    setTrace(null);
    try {
      const r = await testIntegration(i.webhook || i.id);
      setTrace(r.trace_id);
      toast.success(`Test event received — ${r.spans} spans.`);
    } catch {
      toast.error("Test failed — is the collector reachable?");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      {i.method === "otlp" && (
        <p className="rounded-lg border border-splyntra-200 bg-splyntra-50 p-3 text-[12px] text-splyntra-800 dark:border-splyntra-900 dark:bg-splyntra-950/30 dark:text-splyntra-300">
          <b>OTLP-native.</b> Point this platform’s OpenTelemetry exporter at <code className="font-mono">{ingestBaseUrl()}/v1/traces</code> — no glue needed. The webhook recipe below is the alternative.
        </p>
      )}

      {recipe && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Setup steps</h4>
          <ol className="space-y-2">
            {recipe.steps.map((s, n) => (
              <li key={n} className="flex gap-2.5 text-[13px] text-gray-600 dark:text-gray-300">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-500 dark:bg-gray-800">{n + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div>
        <span className="mb-1 block text-xs font-medium text-gray-500">Webhook URL</span>
        <div className="flex items-center gap-2">
          <input readOnly value={url} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300" />
          <CopyButton text={url} />
        </div>
      </div>

      {payloadJSON && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Sample payload</span>
            <CopyButton text={payloadJSON} />
          </div>
          <pre className="max-h-64 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-gray-800 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200"><code>{payloadJSON}</code></pre>
        </div>
      )}

      {recipe && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Copy as cURL</span>
            <CopyButton text={curl} />
          </div>
          <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-gray-800 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200"><code>{curl}</code></pre>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={runTest} disabled={testing} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Test connection
        </button>
        {trace && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-600 dark:text-emerald-400">
            <Check className="h-4 w-4" /> Received — <Link href={oh(viewHref)} className="inline-flex items-center gap-1 underline-offset-2 hover:underline">view <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </span>
        )}
      </div>
      {i.docsHref && (
        <a href={i.docsHref} target="_blank" rel="noreferrer" className="block text-xs text-splyntra-600 hover:underline dark:text-splyntra-300">
          Full docs & field reference <ArrowUpRight className="inline h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
