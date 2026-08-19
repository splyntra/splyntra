// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from "vitest";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { patchBrowserUse } from "./browser-use";

// Fake module mirroring the real `browser-use` npm package (TypeScript port,
// v0.8.x): Agent exposes `run` + `takeStep` (NOT `step`), the step counter lives
// at `agent.state.n_steps`, and actions execute through `Controller.act`.
function makeFakeBrowserUse() {
  class Controller {
    async act(_action: Record<string, unknown>) {
      return { extractedContent: "navigated" };
    }
  }

  class Agent {
    task = "search repos";
    // Seed a non-zero counter so the assertion proves the span reads
    // `agent.state.n_steps` (the real path) and not `agent.n_steps` (→ 0).
    state = { n_steps: 5 };
    controller = new Controller();

    async takeStep(): Promise<[boolean, boolean]> {
      await this.controller.act({ go_to_url: { url: "https://example.com" } });
      return [true, true];
    }

    async run(_maxSteps = 1) {
      await this.takeStep();
      return { done: true };
    }
  }

  return { Agent, Controller };
}

describe("browser-use instrumentor (against the real @0.8.x API shape)", () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    // Reset the global tracer so each test observes only its own spans.
    (trace as unknown as { disable: () => void }).disable();
    trace.setGlobalTracerProvider(provider);
  });

  it("emits agent, step, and tool_call spans", async () => {
    const mod = makeFakeBrowserUse();
    expect(patchBrowserUse(mod)).toBe(true);

    const agent = new mod.Agent();
    await agent.run();

    const spans = exporter.getFinishedSpans();
    const byType = (t: string) =>
      spans.filter((s: ReadableSpan) => s.attributes["splyntra.span.type"] === t);

    // The step span is the regression guard: the old code looked for `step`,
    // which does not exist on the real Agent (the method is `takeStep`).
    expect(byType("agent")).toHaveLength(1);
    expect(byType("step")).toHaveLength(1);
    expect(byType("tool_call")).toHaveLength(1);

    const step = byType("step")[0];
    expect(step.name).toBe("browser_use.step_5"); // reads agent.state.n_steps
    expect(step.attributes["browser.step_number"]).toBe(5);

    const agentSpan = byType("agent")[0];
    expect(agentSpan.attributes["browser.task"]).toBe("search repos");
    expect(agentSpan.attributes["splyntra.framework"]).toBe("browser-use");
  });

  it("is a safe no-op when neither Agent nor Controller is present", () => {
    expect(patchBrowserUse({})).toBe(false);
  });
});
