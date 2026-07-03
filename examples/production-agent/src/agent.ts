// SPDX-License-Identifier: AGPL-3.0-only
// The support-triage agent. Demonstrates the production instrumentation pattern:
// wrap your own business logic (agent + tools) with the SDK's wrappers, and let
// auto-instrumentation capture the LLM provider. Every step becomes a span with
// OK/ERROR status; thrown errors are recorded and re-thrown by the wrappers.
import OpenAI from "openai";
import { wrapAgent, wrapTool, wrapLLM } from "@splyntra/sdk";
import type { Config } from "./config.js";

export interface TicketInput {
  ticketId: string;
  customerEmail: string;
  message: string;
}

export type Category = "billing" | "technical" | "account" | "other";
export type Priority = "low" | "normal" | "high" | "urgent";
type Tier = "free" | "pro" | "enterprise";

export interface TriageResult {
  ticketId: string;
  category: Category;
  priority: Priority;
  customerTier: Tier;
  draftReply: string;
  model: string;
  simulated: boolean;
}

const CATEGORIES: Category[] = ["billing", "technical", "account", "other"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

class TimeoutError extends Error {}

// Reject if `p` does not settle within `ms`. The caller-supplied AbortController
// lets us actually cancel the underlying work (e.g. the OpenAI request), not
// just stop waiting on it.
function withTimeout<T>(p: Promise<T>, ms: number, ac: AbortController, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      ac.abort();
      reject(new TimeoutError(`${label} timed out after ${ms}ms`));
    }, ms);
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

// Retry transient failures with exponential backoff + jitter. Aborts (timeouts,
// cancellations) and 4xx-class client errors are NOT retried.
async function withRetry<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 200): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const retriable = !(err instanceof TimeoutError) && !(status && status >= 400 && status < 500);
      if (attempt === retries || !retriable) break;
      const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * baseDelayMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function coerce<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

// Stand-in for a real customer datastore. Wrapped as a tool so its latency and
// failures show up as a tool_call span in the trace.
function makeLookupCustomer() {
  return wrapTool(async (email: string): Promise<{ name: string; tier: Tier; openTickets: number }> => {
    await new Promise((r) => setTimeout(r, 40)); // simulate a DB round-trip
    const seed = [...email].reduce((a, c) => a + c.charCodeAt(0), 0);
    const tier: Tier = (["free", "pro", "enterprise"] as const)[seed % 3]!;
    return { name: email.split("@")[0] ?? "customer", tier, openTickets: seed % 4 };
  }, "crm.lookup_customer");
}

const SYSTEM_PROMPT =
  "You are a support triage assistant. Classify the ticket and draft a brief, " +
  "professional first reply. Respond ONLY with JSON of the form " +
  '{"category": "billing|technical|account|other", "priority": "low|normal|high|urgent", "draftReply": "..."}.';

interface ClassifyResult {
  raw: string;
  model: string;
  simulated: boolean;
}
type Classifier = (ticket: TicketInput, ac: AbortController) => Promise<ClassifyResult>;

// Builds the LLM step. Real path: OpenAI, captured automatically by the openai
// instrumentor. Simulated path: a wrapLLM-wrapped local function so traces (and
// token/cost attributes) still flow without a provider account.
function makeClassifier(cfg: Config): Classifier {
  // Real providers (OpenAI, or Gemini via its OpenAI-compatible endpoint) share
  // one code path — Gemini just supplies a base URL. The SDK's openai
  // auto-instrumentor patches the client prototype, so both are traced with
  // token usage regardless of the base URL.
  if (cfg.llm.provider !== "simulated" && cfg.llm.apiKey) {
    const client = new OpenAI({
      apiKey: cfg.llm.apiKey,
      ...(cfg.llm.baseURL ? { baseURL: cfg.llm.baseURL } : {}),
    });
    // Explicitly wrap the provider call in an llm_call span. `instrument:
    // ["openai"]` auto-instrumentation also works (the SDK patches both the CJS
    // and ESM builds of openai), but wrapping explicitly is version-independent
    // and guarantees exactly one span — a good default for a production service.
    // It captures token usage from the response for both OpenAI and Gemini
    // (Gemini via its OpenAI-compatible endpoint).
    const complete = wrapLLM(
      (ticket: TicketInput, ac: AbortController) =>
        client.chat.completions.create(
          {
            model: cfg.llm.model,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: ticket.message },
            ],
          },
          { signal: ac.signal },
        ),
      cfg.llm.model,
      cfg.llm.provider,
    );
    return async (ticket: TicketInput, ac: AbortController): Promise<ClassifyResult> => {
      const res = await complete(ticket, ac);
      return { raw: res.choices[0]?.message?.content ?? "{}", model: cfg.llm.model, simulated: false };
    };
  }

  const simulatedModel = "simulated-triage-v1";

  const simulate = wrapLLM(
    async (message: string) => {
      await new Promise((r) => setTimeout(r, 80));
      const lower = message.toLowerCase();
      const category: Category = lower.includes("charge") || lower.includes("invoice")
        ? "billing"
        : lower.includes("error") || lower.includes("crash")
          ? "technical"
          : lower.includes("login") || lower.includes("password")
            ? "account"
            : "other";
      const priority: Priority = lower.includes("urgent") || lower.includes("down") ? "urgent" : "normal";
      const body = JSON.stringify({
        category,
        priority,
        draftReply: `Thanks for reaching out — we've logged this as a ${category} issue and a specialist will follow up shortly.`,
      });
      // wrapLLM reads `usage` for token/cost analytics.
      return { content: body, usage: { prompt_tokens: 120, completion_tokens: 60 } };
    },
    "simulated-triage-v1",
    "splyntra-sim",
  );

  return async (ticket: TicketInput, _ac: AbortController): Promise<ClassifyResult> => {
    const out = await simulate(ticket.message);
    return { raw: out.content, model: simulatedModel, simulated: true };
  };
}

// Factory returns the wrapped top-level agent. Inject config so it stays
// testable and free of module-level singletons.
export function createTriageAgent(cfg: Config) {
  const lookupCustomer = makeLookupCustomer();
  const classify = makeClassifier(cfg);

  return wrapAgent(
    async (ticket: TicketInput, ac: AbortController): Promise<TriageResult> => {
      const customer = await lookupCustomer(ticket.customerEmail);

      const llm = await withRetry(() => classify(ticket, ac));
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(llm.raw) as Record<string, unknown>;
      } catch {
        // Model returned non-JSON — fall back to safe defaults rather than throw,
        // so a flaky completion degrades instead of failing the request.
        parsed = {};
      }

      // Enterprise customers float to at least high priority — a deterministic
      // business rule layered on top of the model's suggestion.
      let priority = coerce<Priority>(parsed.priority, PRIORITIES, "normal");
      if (customer.tier === "enterprise" && (priority === "low" || priority === "normal")) {
        priority = "high";
      }

      return {
        ticketId: ticket.ticketId,
        category: coerce<Category>(parsed.category, CATEGORIES, "other"),
        priority,
        customerTier: customer.tier,
        draftReply: typeof parsed.draftReply === "string" && parsed.draftReply.trim()
          ? parsed.draftReply
          : "Thanks for reaching out — a specialist will follow up shortly.",
        model: llm.model,
        simulated: llm.simulated,
      };
    },
    "support_triage_agent",
    "support-triage",
  );
}

export { TimeoutError, withTimeout };
