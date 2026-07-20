// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Check, Server, ArrowUpRight, ShieldCheck } from "lucide-react";
import { Badge, BadgeTone } from "@/components/ui/Badge";
import { SearchInput } from "@/components/ui/SearchInput";
import { Drawer } from "@/components/ui/Drawer";
import { CatalogIcon, catalogIcon } from "@/lib/catalog-icons";
import { RecipeView } from "@/components/catalog/RecipeView";
import { Integration, Tier, TIER_LABEL, codeSnippets, ingestBaseUrl } from "@/lib/catalog";
import { useOrgHref } from "@/lib/org-path";

const TIER_TONE: Record<Tier, BadgeTone> = { native: "brand", auto: "neutral", cost: "success", planned: "muted" };

function tierBadges(tiers: Tier[]) {
  return tiers.map((t) => (
    <Badge key={t} tone={TIER_TONE[t]}>
      {TIER_LABEL[t]}
    </Badge>
  ));
}

function CopyBtn({ text }: { text: string }) {
  const [c, setC] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setC(true);
        setTimeout(() => setC(false), 1200);
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
    >
      {c ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {c ? "Copied" : "Copy"}
    </button>
  );
}

// MCP connect guide: protocol-level, transport-agnostic instrumentation. Splyntra
// wraps the MCP client session — it observes tools/call, it does not proxy the
// server. Shows prerequisites, both language snippets, and what gets captured.
function McpSetup({ i }: { i: Integration }) {
  const oh = useOrgHref();
  const [lang, setLang] = useState<"python" | "typescript">("python");
  const endpoint = ingestBaseUrl();

  const py =
    `# pip install splyntra "mcp"\n` +
    `import os\n` +
    `from splyntra import Splyntra\n\n` +
    `# Instrument once at startup — wraps the MCP ClientSession.\n` +
    `Splyntra(\n` +
    `    api_key=os.environ["SPLYNTRA_API_KEY"],\n` +
    `    project="my-app",\n` +
    `    endpoint="${endpoint}",\n` +
    `    instrument=("mcp",),      # trace every tools/call\n` +
    `    redact_by_default=True,   # strip secrets / PII from args + results\n` +
    `)\n\n` +
    `# Use your MCP client as usual — each call is traced automatically:\n` +
    `# async with ClientSession(read, write) as session:\n` +
    `#     await session.call_tool("issues.create", {...})`;

  const ts =
    `// npm install @splyntra/sdk @modelcontextprotocol/sdk\n` +
    `import { Splyntra } from "@splyntra/sdk";\n\n` +
    `// Instrument once at startup — wraps the MCP Client.\n` +
    `new Splyntra({\n` +
    `  apiKey: process.env.SPLYNTRA_API_KEY!,\n` +
    `  project: "my-app",\n` +
    `  endpoint: "${endpoint}",\n` +
    `  instrument: ["mcp"],       // trace every tools/call\n` +
    `  redactByDefault: true,     // strip secrets / PII from args + results\n` +
    `});\n\n` +
    `// Use your MCP client as usual — each client.callTool(...) is traced.`;

  const snippet = lang === "python" ? py : ts;
  const captures = [
    "Server + tool name",
    "Arguments & result (redacted)",
    "Latency & p95",
    "Errors / failure rate",
    "Permission violations",
    "Transport (stdio / SSE / HTTP)",
  ];

  return (
    <div className="space-y-5">
      <p className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-300">
        Splyntra observes <b>{i.name}</b> at the protocol layer — it wraps the MCP client session so every{" "}
        <code className="rounded bg-gray-100 px-1 font-mono text-[11px] dark:bg-gray-800">tools/call</code> becomes a traced{" "}
        <code className="rounded bg-gray-100 px-1 font-mono text-[11px] dark:bg-gray-800">tool_call</code> span. It doesn’t proxy or replace the server — keep {i.name} configured with its own credentials.
      </p>

      {/* Prerequisites */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3.5 text-[12px] text-gray-600 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-300">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Prerequisites</span>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>{i.name} server reachable and authenticated (its own token / OAuth).</li>
          <li>An ingest key — mint one in <Link href={oh("/settings/keys")} className="text-splyntra-600 hover:underline dark:text-splyntra-300">Settings → API keys</Link>, then export it as <code className="rounded bg-white px-1 font-mono text-[11px] dark:bg-gray-900">SPLYNTRA_API_KEY</code>.</li>
          <li>The official MCP client SDK (<code className="font-mono text-[11px]">mcp</code> for Python or <code className="font-mono text-[11px]">@modelcontextprotocol/sdk</code> for TS).</li>
        </ul>
      </div>

      {/* Language toggle + snippet */}
      <div>
        <div className="mb-2 inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
          {(["python", "typescript"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${lang === l ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}
            >
              {l === "python" ? "Python" : "TypeScript"}
            </button>
          ))}
        </div>
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 pr-14 font-mono text-[12px] leading-relaxed text-gray-800 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200"><code>{snippet}</code></pre>
          <div className="absolute right-2 top-2"><CopyBtn text={snippet} /></div>
        </div>
      </div>

      {/* What's captured */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Captured on every call</h4>
        <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {captures.map((c) => (
            <li key={c} className="flex items-center gap-1.5 text-[12px] text-gray-600 dark:text-gray-300">
              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden /> {c}
            </li>
          ))}
        </ul>
      </div>

      {/* Redaction note + dashboard link */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-gray-500">
          <ShieldCheck className="h-3.5 w-3.5 text-gray-400" /> Args & results are redacted before storage.
        </span>
        <Link href={oh("/mcp")} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-splyntra-600 hover:underline dark:text-splyntra-300">
          <Server className="h-3.5 w-3.5" /> Open MCP Servers <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {i.docsHref && (
        <a href={i.docsHref} target="_blank" rel="noreferrer" className="block text-xs text-splyntra-600 hover:underline dark:text-splyntra-300">
          Full docs & field reference <ArrowUpRight className="inline h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

function Setup({ i }: { i: Integration }) {
  const oh = useOrgHref();
  if (i.tier.includes("planned")) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700">
        <p className="font-medium text-gray-700 dark:text-gray-200">On the roadmap.</p>
        <p className="mt-1">This integration isn’t shipped yet. Want it prioritized?{" "}
          <a href="https://github.com/splyntra/splyntra/issues" target="_blank" rel="noreferrer" className="text-splyntra-600 hover:underline">Request it</a>.
        </p>
      </div>
    );
  }

  // MCP → dedicated protocol-level setup (prerequisites, both languages, capture).
  if (i.method === "mcp") return <McpSetup i={i} />;

  // SDK / provider-compat → code snippet.
  if (i.method === "sdk" || i.method === "provider-compat") {
    const snip = codeSnippets(i.instrument || "openai", "my-app");
    return (
      <div className="space-y-3">
        {i.baseUrl && (
          <p className="text-[13px] text-gray-600 dark:text-gray-300">
            Point your OpenAI client at <code className="font-mono text-xs">{i.baseUrl}</code>, then instrument it:
          </p>
        )}
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 pr-14 font-mono text-[12px] leading-relaxed text-gray-800 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-200"><code>{snip.python}</code></pre>
          <div className="absolute right-2 top-2"><CopyBtn text={snip.python} /></div>
        </div>
        <p className="text-xs text-gray-500">Or build a fully-configured agent in the <Link href={oh("/agents/new")} className="text-splyntra-600 hover:underline">Connect wizard</Link>.</p>
      </div>
    );
  }

  // webhook / otlp → the full connect recipe (shared with the platform wizard).
  return <RecipeView i={i} />;
}

export function CatalogDirectory({ integrations }: { integrations: Integration[] }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Integration | null>(null);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return integrations.filter((i) => !s || i.name.toLowerCase().includes(s) || i.blurb.toLowerCase().includes(s));
  }, [q, integrations]);

  return (
    <>
      <SearchInput value={q} onChange={setQ} placeholder="Search integrations…" className="mb-4 max-w-sm" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((i) => (
          <button
            key={i.id}
            onClick={() => setActive(i)}
            className="flex flex-col rounded-xl border border-gray-200/80 p-4 text-left outline-none transition-all hover:border-splyntra-300 hover:bg-gray-50/50 focus-visible:ring-2 focus-visible:ring-splyntra-400 dark:border-gray-800 dark:hover:border-splyntra-700 dark:hover:bg-gray-900/40"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <CatalogIcon name={i.icon} className="h-4 w-4" />
              </span>
              <div className="flex flex-wrap justify-end gap-1">{tierBadges(i.tier)}</div>
            </div>
            <span className="mt-2.5 text-sm font-semibold text-gray-900 dark:text-white">{i.name}</span>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{i.blurb}</p>
          </button>
        ))}
      </div>
      {filtered.length === 0 && <p className="py-10 text-center text-sm text-gray-500">No integrations match “{q}”.</p>}

      <Drawer
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.name || ""}
        subtitle={active?.blurb}
        icon={active ? catalogIcon(active.icon) : undefined}
        footer={active ? <div className="flex flex-wrap gap-1.5">{tierBadges(active.tier)}</div> : undefined}
      >
        {active && <Setup i={active} />}
      </Drawer>
    </>
  );
}
