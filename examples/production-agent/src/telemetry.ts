// SPDX-License-Identifier: AGPL-3.0-only
// Owns the single Splyntra tracer for the process. Constructing Splyntra wires
// the OTLP exporter, client-side redaction, and auto-instrumentation — so this
// MUST be initialized before any LLM/agent code runs (the openai instrumentor
// patches the client prototype at construction time).
import { Splyntra } from "@splyntra/sdk";
import type { Config } from "./config.js";
import { log } from "./log.js";

let instance: Splyntra | null = null;

export function initTelemetry(cfg: Config): Splyntra {
  if (instance) return instance;
  instance = new Splyntra({
    apiKey: cfg.splyntra.apiKey,
    project: cfg.splyntra.project,
    endpoint: cfg.splyntra.endpoint,
    environment: cfg.env,
    serviceName: "support-triage-agent",
    // No auto-instrumentation: the agent wraps its LLM call explicitly with
    // wrapLLM (see agent.ts). That's reliable across ESM/CJS, whereas the openai
    // auto-instrumentor patches the package's CJS build only. Wrapping explicitly
    // also keeps exactly one llm_call span (no risk of double-instrumenting).
    instrument: [],
    // Strip high-confidence secrets from spans before they leave this process.
    // On by default; pinned here to make the production intent explicit.
    redactByDefault: true,
  });
  log.info("telemetry initialized", {
    project: cfg.splyntra.project,
    endpoint: cfg.splyntra.endpoint,
    environment: cfg.env,
    llmProvider: cfg.llm.provider,
    model: cfg.llm.model,
    instrumentation: "explicit (wrapLLM)",
  });
  return instance;
}

// Flush buffered spans and tear down the exporter. Call during graceful
// shutdown so in-flight traces are not lost when the process exits.
export async function shutdownTelemetry(): Promise<void> {
  if (!instance) return;
  await instance.shutdown();
  instance = null;
}
