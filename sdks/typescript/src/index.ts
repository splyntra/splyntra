// SPDX-License-Identifier: Apache-2.0
import { trace, Tracer, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { makeOtlpExporter } from "./exporters";
import { RedactingSpanProcessor } from "./redaction";
import { instrument as instrumentFrameworks } from "./instrumentors";
import { configureGuard, GuardMode } from "./guard";

export interface SplyntraConfig {
  apiKey: string;
  project: string;
  endpoint?: string;
  environment?: string;
  serviceName?: string;
  /** Framework label, surfaced for agent registration (e.g. "langgraph"). */
  framework?: string;
  /** Redact high-confidence secrets from spans before export. Default: true. */
  redactByDefault?: boolean;
  /** Frameworks to auto-instrument, e.g. ["openai", "langgraph"]. */
  instrument?: string[];
  /** Inline guardrail mode: "off" (default), "monitor" (log only), "block". */
  guard?: GuardMode;
  /** On guard error/timeout: proceed (true, default) or block (false). */
  guardFailOpen?: boolean;
}

export class Splyntra {
  private provider: NodeTracerProvider;
  private _tracer: Tracer;

  constructor(config: SplyntraConfig) {
    const {
      apiKey,
      project,
      endpoint = "http://localhost:4318",
      environment = "development",
      serviceName,
      framework,
      redactByDefault = true,
      instrument,
      guard = "off",
      guardFailOpen = true,
    } = config;

    if (!apiKey) {
      throw new Error("Splyntra: apiKey is required");
    }
    if (!project) {
      throw new Error("Splyntra: project is required");
    }

    const resourceAttrs: Record<string, string> = {
      "service.name": serviceName || project,
      "splyntra.project": project,
      "splyntra.environment": environment,
      "deployment.environment": environment,
    };
    if (framework) {
      resourceAttrs["splyntra.framework"] = framework;
    }
    const resource = new Resource(resourceAttrs);

    const exporter = makeOtlpExporter(endpoint, apiKey, project);

    this.provider = new NodeTracerProvider({ resource });
    // Redaction runs before export so secrets never leave this process.
    if (redactByDefault) {
      this.provider.addSpanProcessor(new RedactingSpanProcessor());
    }
    this.provider.addSpanProcessor(new BatchSpanProcessor(exporter));
    this.provider.register();

    this._tracer = trace.getTracer("splyntra", "0.1.0");

    // Configure the inline guardrail used by the instrumentors' pre-flight hook.
    configureGuard({ mode: guard, failOpen: guardFailOpen, endpoint, apiKey });

    if (instrument && instrument.length) {
      instrumentFrameworks(...instrument);
    }

    // Ensure spans are flushed on process exit
    const gracefulShutdown = () => {
      this.provider.shutdown().finally(() => process.exit(0));
    };
    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);
  }

  get tracer(): Tracer {
    return this._tracer;
  }

  async shutdown(): Promise<void> {
    await this.provider.shutdown();
  }
}

export function traceAgent(name: string, workflow?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const original = descriptor.value;
    descriptor.value = function (...args: any[]) {
      const tracer = trace.getTracer("splyntra");
      return tracer.startActiveSpan(
        name,
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            "splyntra.span.type": "agent",
            "splyntra.agent.name": name,
            "splyntra.workflow": workflow || "",
          },
        },
        (span) => {
          try {
            const result = original.apply(this, args);
            if (result instanceof Promise) {
              return result
                .then((res: any) => {
                  span.setStatus({ code: SpanStatusCode.OK });
                  span.end();
                  return res;
                })
                .catch((err: Error) => {
                  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                  span.recordException(err);
                  span.end();
                  throw err;
                });
            }
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return result;
          } catch (err: any) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.recordException(err);
            span.end();
            throw err;
          }
        }
      );
    };
    return descriptor;
  };
}

export function traceTool(name: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const original = descriptor.value;
    descriptor.value = function (...args: any[]) {
      const tracer = trace.getTracer("splyntra");
      return tracer.startActiveSpan(
        name,
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            "splyntra.span.type": "tool_call",
            "splyntra.tool.name": name,
          },
        },
        (span) => {
          const start = performance.now();
          try {
            const result = original.apply(this, args);
            if (result instanceof Promise) {
              return result
                .then((res: any) => {
                  span.setAttribute("splyntra.tool.duration_ms", performance.now() - start);
                  span.setStatus({ code: SpanStatusCode.OK });
                  span.end();
                  return res;
                })
                .catch((err: Error) => {
                  span.setAttribute("splyntra.tool.duration_ms", performance.now() - start);
                  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                  span.recordException(err);
                  span.end();
                  throw err;
                });
            }
            span.setAttribute("splyntra.tool.duration_ms", performance.now() - start);
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return result;
          } catch (err: any) {
            span.setAttribute("splyntra.tool.duration_ms", performance.now() - start);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.recordException(err);
            span.end();
            throw err;
          }
        }
      );
    };
    return descriptor;
  };
}

export function traceLLM(model: string, provider?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const original = descriptor.value;
    descriptor.value = function (...args: any[]) {
      const tracer = trace.getTracer("splyntra");
      return tracer.startActiveSpan(
        `llm.${model}`,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            "splyntra.span.type": "llm_call",
            "gen_ai.system": provider || "unknown",
            "gen_ai.request.model": model,
          },
        },
        (span) => {
          const start = performance.now();
          try {
            const result = original.apply(this, args);
            if (result instanceof Promise) {
              return result
                .then((res: any) => {
                  span.setAttribute("gen_ai.latency_ms", performance.now() - start);
                  if (res && typeof res === "object" && "usage" in res) {
                    const usage = res.usage;
                    if (usage.prompt_tokens) span.setAttribute("gen_ai.usage.prompt_tokens", usage.prompt_tokens);
                    if (usage.completion_tokens) span.setAttribute("gen_ai.usage.completion_tokens", usage.completion_tokens);
                  }
                  span.setStatus({ code: SpanStatusCode.OK });
                  span.end();
                  return res;
                })
                .catch((err: Error) => {
                  span.setAttribute("gen_ai.latency_ms", performance.now() - start);
                  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                  span.recordException(err);
                  span.end();
                  throw err;
                });
            }
            span.setAttribute("gen_ai.latency_ms", performance.now() - start);
            if (result && typeof result === "object" && "usage" in result) {
              const usage = result.usage;
              if (usage.prompt_tokens) span.setAttribute("gen_ai.usage.prompt_tokens", usage.prompt_tokens);
              if (usage.completion_tokens) span.setAttribute("gen_ai.usage.completion_tokens", usage.completion_tokens);
            }
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return result;
          } catch (err: any) {
            span.setAttribute("gen_ai.latency_ms", performance.now() - start);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.recordException(err);
            span.end();
            throw err;
          }
        }
      );
    };
    return descriptor;
  };
}

// ─── Function-style wrappers ──────────────────────────────────────────────
// The decorators above only apply to class methods. These wrap plain functions
// (sync or async) so non-class code can be instrumented in one line.

function wrapSpan<T extends (...args: any[]) => any>(
  fn: T,
  name: string,
  kind: SpanKind,
  attributes: Record<string, any>,
  onResult?: (span: import("@opentelemetry/api").Span, res: any) => void
): T {
  return function (this: any, ...args: any[]) {
    const tracer = trace.getTracer("splyntra");
    return tracer.startActiveSpan(name, { kind, attributes }, (span) => {
      const finishOk = (res: any) => {
        if (onResult) {
          try {
            onResult(span, res);
          } catch {
            /* never let attribute extraction break the wrapped call */
          }
        }
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return res;
      };
      const finishErr = (err: any) => {
        span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
        span.recordException(err);
        span.end();
        throw err;
      };
      try {
        const result = fn.apply(this, args);
        if (result instanceof Promise) {
          return result.then(finishOk).catch(finishErr);
        }
        return finishOk(result);
      } catch (err: any) {
        return finishErr(err);
      }
    });
  } as T;
}

/** Wrap a plain function as an agent root span. */
export function wrapAgent<T extends (...args: any[]) => any>(fn: T, name: string, workflow?: string): T {
  return wrapSpan(fn, name, SpanKind.INTERNAL, {
    "splyntra.span.type": "agent",
    "splyntra.agent.name": name,
    "splyntra.workflow": workflow || "",
  });
}

/** Wrap a plain function as a tool-call span. */
export function wrapTool<T extends (...args: any[]) => any>(fn: T, name: string): T {
  return wrapSpan(fn, name, SpanKind.INTERNAL, {
    "splyntra.span.type": "tool_call",
    "splyntra.tool.name": name,
  });
}

/**
 * Wrap a plain function as an LLM-call span. If the wrapped function returns an
 * object with a `usage` field (`{ prompt_tokens, completion_tokens }`), token
 * counts are recorded for cost analytics.
 */
export function wrapLLM<T extends (...args: any[]) => any>(fn: T, model: string, provider?: string): T {
  return wrapSpan(
    fn,
    `llm.${model}`,
    SpanKind.CLIENT,
    {
      "splyntra.span.type": "llm_call",
      "gen_ai.system": provider || "unknown",
      "gen_ai.request.model": model,
    },
    (span, res) => {
      const usage = res && typeof res === "object" ? (res as any).usage : undefined;
      if (usage) {
        if (usage.prompt_tokens) span.setAttribute("gen_ai.usage.prompt_tokens", usage.prompt_tokens);
        if (usage.completion_tokens) span.setAttribute("gen_ai.usage.completion_tokens", usage.completion_tokens);
      }
    }
  );
}

export { instrument, instrumentOpenAI, instrumentAnthropic, instrumentOllama, instrumentLangGraph, instrumentCrewAI, instrumentOpenAIAgents, instrumentMCP } from "./instrumentors";
export { RedactingSpanProcessor, redactString } from "./redaction";
export { SplyntraBlocked, enforceGuard, configureGuard } from "./guard";
export type { GuardMode } from "./guard";
export { makeOtlpExporter } from "./exporters";
export { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
