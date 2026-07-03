// SPDX-License-Identifier: AGPL-3.0-only
// Validated, immutable runtime configuration. Loaded once at startup so the
// service fails fast (before binding a port) when something required is missing
// or nonsensical — never half-configured in production.

export type Environment = "production" | "staging" | "development";
export type LlmProvider = "gemini" | "openai" | "simulated";

export interface Config {
  env: Environment;
  port: number;
  requestTimeoutMs: number;
  splyntra: {
    apiKey: string;
    project: string;
    endpoint: string;
  };
  llm: {
    /** Which provider the classifier calls. "simulated" needs no account. */
    provider: LlmProvider;
    /** null only when provider === "simulated". */
    apiKey: string | null;
    model: string;
    /** OpenAI-compatible base URL. Set for Gemini; null uses the OpenAI default. */
    baseURL: string | null;
  };
}

// Gemini speaks the OpenAI Chat Completions API at this base URL, so the same
// OpenAI client + the SDK's openai auto-instrumentor capture it with no extra code.
const GEMINI_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : fallback;
}

function intInRange(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}], got ${JSON.stringify(raw)}`);
  }
  return n;
}

function parseEnv(): Environment {
  const v = optional("NODE_ENV", "development");
  if (v !== "production" && v !== "staging" && v !== "development") {
    throw new Error(`NODE_ENV must be production|staging|development, got ${JSON.stringify(v)}`);
  }
  return v;
}

// Resolve the LLM provider. Precedence: Gemini → OpenAI → simulated. Both real
// providers go through the OpenAI client (Gemini via its OpenAI-compatible base
// URL), so a single auto-instrumentor covers them.
function resolveLlm(): Config["llm"] {
  const gemini = process.env.GEMINI_API_KEY?.trim();
  if (gemini) {
    return {
      provider: "gemini",
      apiKey: gemini,
      model: optional("GEMINI_MODEL", "gemini-2.5-flash"),
      baseURL: optional("GEMINI_BASE_URL", GEMINI_OPENAI_BASE),
    };
  }
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (openai) {
    return { provider: "openai", apiKey: openai, model: optional("OPENAI_MODEL", "gpt-4o-mini"), baseURL: null };
  }
  return { provider: "simulated", apiKey: null, model: "simulated-triage-v1", baseURL: null };
}

export function loadConfig(): Config {
  const env = parseEnv();

  const cfg: Config = {
    env,
    port: intInRange("PORT", 8080, 1, 65535),
    requestTimeoutMs: intInRange("REQUEST_TIMEOUT_MS", 15000, 1000, 120000),
    splyntra: {
      apiKey: required("SPLYNTRA_API_KEY"),
      project: required("SPLYNTRA_PROJECT"),
      endpoint: optional("SPLYNTRA_ENDPOINT", "http://localhost:4318"),
    },
    llm: resolveLlm(),
  };

  // In production, refuse the dev key and an insecure endpoint — these are the
  // single most common "works in staging, leaks in prod" misconfigurations.
  if (cfg.env === "production") {
    if (cfg.splyntra.apiKey === "splyntra_dev_key") {
      throw new Error("Refusing to start: SPLYNTRA_API_KEY is the shared dev key in production");
    }
    if (cfg.splyntra.endpoint.startsWith("http://") && !cfg.splyntra.endpoint.includes("localhost")) {
      throw new Error("Refusing to start: SPLYNTRA_ENDPOINT must be https:// in production");
    }
  }

  return cfg;
}
