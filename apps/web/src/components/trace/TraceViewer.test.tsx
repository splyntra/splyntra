// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TraceViewer } from "./TraceViewer";
import { Trace } from "@/types/trace";

const trace: Trace = {
  traceId: "tr_8f3abc",
  agentId: "support_agent",
  workflowId: "wf_refund",
  status: "ok",
  latencyMs: 1200,
  totalTokens: 340,
  costUsd: 0.004,
  riskScore: 72,
  riskSeverity: "HIGH",
  detections: [
    {
      detector: "secrets",
      category: "aws_key",
      severity: "CRITICAL",
      confidence: 0.95,
      description: "AWS key in tool input",
      beta: false,
    },
    {
      detector: "injection",
      category: "instruction_override",
      severity: "MEDIUM",
      confidence: 0.7,
      description: "instruction override pattern",
      beta: true,
    },
  ],
  spans: [
    {
      spanId: "sp_1",
      type: "llm_call",
      name: "plan refund",
      status: "ok",
      latencyMs: 220,
      detections: [],
      startedAt: new Date(0).toISOString(),
    },
    {
      spanId: "sp_2",
      type: "tool_call",
      name: "payments.refund",
      status: "ok",
      latencyMs: 680,
      detections: [],
      startedAt: new Date(0).toISOString(),
    },
  ],
  startedAt: new Date(0).toISOString(),
  completedAt: new Date(0).toISOString(),
  orgId: "org_1",
  projectId: "proj_1",
  environment: "development",
};

describe("TraceViewer (unified trace + risk view)", () => {
  it("renders the trace id, agent, and risk score together", () => {
    render(<TraceViewer trace={trace} />);
    expect(screen.getByText("tr_8f3abc")).toBeInTheDocument();
    expect(screen.getByText("support_agent")).toBeInTheDocument();
    // Risk score is surfaced as part of the unified view.
    expect(screen.getByText(/72/)).toBeInTheDocument();
  });

  it("renders security detections including the beta injection finding", () => {
    render(<TraceViewer trace={trace} />);
    expect(screen.getByText(/AWS key in tool input/)).toBeInTheDocument();
    expect(screen.getByText(/instruction override pattern/)).toBeInTheDocument();
  });

  it("renders execution steps for replay", () => {
    render(<TraceViewer trace={trace} />);
    expect(screen.getByText("plan refund")).toBeInTheDocument();
    expect(screen.getByText("payments.refund")).toBeInTheDocument();
  });
});
