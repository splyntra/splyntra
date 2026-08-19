// SPDX-License-Identifier: Apache-2.0
import { trace, SpanKind, SpanStatusCode, Span } from "@opentelemetry/api";
import { patchDual, pick } from "./patch";

/**
 * Auto-instrument Browser Use for JavaScript / TypeScript.
 *
 * Wraps:
 * - Agent.prototype.run (agent root span)
 * - Agent.prototype.step (step span)
 * - Controller.prototype.act / multiAct (tool_call span)
 *
 * Best-effort: a safe no-op if the package is absent or its API differs.
 * Patches both CJS and ESM module exports.
 *
 * Returns true if the patch wrapped at least one method.
 */
export function instrumentBrowserUse(): boolean {
  return patchDual(["browser-use", "@browser-use/core", "@browser-use/agent"], patchBrowserUse);
}

function patchBrowserUse(mod: unknown): boolean {
  const Agent = pick(mod, "Agent") as { prototype?: any } | undefined;
  const Controller = pick(mod, "Controller") as { prototype?: any } | undefined;

  let wrapped = false;

  // 1. Wrap Agent.prototype.run
  wrapped =
    wrapMethod(
      Agent?.prototype,
      ["run", "runAsync", "execute"],
      "agent",
      (self, args) => {
        const task = self?.task || args?.[0] || "browser_task";
        const taskSnippet = typeof task === "string" ? task.slice(0, 40) : "browser_task";
        return `browser_use.agent:${taskSnippet}`;
      },
      (self, args) => ({
        "splyntra.framework": "browser-use",
        "splyntra.agent.name": "browser_agent",
        "splyntra.workflow": "web_browsing",
        "browser.task": String(self?.task || args?.[0] || "").slice(0, 500),
      })
    ) || wrapped;

  // 2. Wrap Agent.prototype.step
  wrapped =
    wrapMethod(
      Agent?.prototype,
      ["step", "stepAsync"],
      "step",
      (self) => {
        const stepNum = self?.n_steps ?? self?.stepCount ?? 0;
        return `browser_use.step_${stepNum}`;
      },
      (self) => ({
        "splyntra.framework": "browser-use",
        "browser.step_number": self?.n_steps ?? self?.stepCount ?? 0,
      })
    ) || wrapped;

  // 3. Wrap Controller.prototype.act
  wrapped =
    wrapMethod(
      Controller?.prototype,
      ["act", "multiAct", "runAction"],
      "tool_call",
      (_self, args) => {
        const action = args?.[0];
        const actionName = action?.constructor?.name || action?.name || action?.type || "action";
        return `browser.${String(actionName).toLowerCase()}`;
      },
      (_self, args) => {
        const action = args?.[0];
        const inputData = action ? JSON.stringify(action).slice(0, 400) : "";
        return {
          "splyntra.framework": "browser-use",
          "splyntra.input": inputData,
        };
      }
    ) || wrapped;

  return wrapped;
}

function wrapMethod(
  proto: any,
  methodNames: string[],
  spanType: string,
  nameOf: (self: any, args: any[]) => string,
  attributesOf?: (self: any, args: any[]) => Record<string, any>
): boolean {
  if (!proto) return false;
  const method = methodNames.find((m) => typeof proto[m] === "function" && !proto[m].__splyntraWrapped);
  if (!method) return false;
  const original = proto[method];

  function patched(this: any, ...args: any[]) {
    const name = nameOf(this, args);
    const extraAttrs = attributesOf ? attributesOf(this, args) : {};
    const tracer = trace.getTracer("splyntra.browser-use");

    return tracer.startActiveSpan(
      name,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "splyntra.span.type": spanType,
          [spanType === "tool_call" ? "splyntra.tool.name" : spanType === "step" ? "splyntra.step.name" : "splyntra.agent.name"]: name,
          "splyntra.framework": "browser-use",
          ...extraAttrs,
        },
      },
      (span: Span) => {
        let result: any;
        const start = performance.now();
        try {
          result = original.apply(this, args);
        } catch (err: any) {
          span.setAttribute("splyntra.tool.duration_ms", performance.now() - start);
          span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
          span.recordException(err);
          span.end();
          throw err;
        }

        return Promise.resolve(result)
          .then((res: any) => {
            span.setAttribute("splyntra.tool.duration_ms", performance.now() - start);
            if (res !== undefined && res !== null) {
              span.setAttribute("splyntra.output", typeof res === "string" ? res.slice(0, 1000) : JSON.stringify(res).slice(0, 1000));
            }
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return res;
          })
          .catch((err: any) => {
            span.setAttribute("splyntra.tool.duration_ms", performance.now() - start);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
            span.recordException(err);
            span.end();
            throw err;
          });
      }
    );
  }

  (patched as any).__splyntraWrapped = true;
  proto[method] = patched;
  return true;
}
