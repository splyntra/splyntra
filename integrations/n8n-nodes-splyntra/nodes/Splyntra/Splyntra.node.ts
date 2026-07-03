// SPDX-License-Identifier: Apache-2.0
import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionType } from "n8n-workflow";

// Splyntra node — POSTs an n8n run summary to the collector's
// /v1/integrations/n8n webhook. Drop it at the end of a workflow; it fills in
// the workflow id/name + execution id automatically and lets you map a `nodes`
// array of step summaries (or send a single agent span if omitted).
export class Splyntra implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Splyntra",
    name: "splyntra",
    icon: "file:splyntra.svg",
    group: ["output"],
    version: 1,
    subtitle: '={{ "→ " + $parameter["status"] }}',
    description: "Send this workflow's run telemetry to Splyntra (trace / cost / security).",
    defaults: { name: "Splyntra" },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    credentials: [{ name: "splyntraApi", required: true }],
    properties: [
      {
        displayName: "Status",
        name: "status",
        type: "string",
        default: "success",
        description: "Overall run status (success | error).",
      },
      {
        displayName: "Steps (nodes)",
        name: "nodes",
        type: "json",
        default: "[]",
        description:
          "Array of step summaries: { name, type, model?, prompt_tokens?, completion_tokens?, elapsed_ms?, status?, input?, output? }. " +
          "Leave as [] to record a single agent span for the run.",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const wf = this.getWorkflow();
    const executionId = this.getExecutionId();

    // Build the payload once from the node's parameters (evaluated against the
    // first item's context; use expressions to pull data from upstream nodes).
    const status = this.getNodeParameter("status", 0, "success") as string;
    const nodesParam = this.getNodeParameter("nodes", 0, []) as unknown;
    const nodes = typeof nodesParam === "string" ? safeParse(nodesParam) : nodesParam;

    const payload = {
      workflow: { id: String(wf.id ?? ""), name: String(wf.name ?? "n8n-workflow") },
      execution_id: String(executionId ?? ""),
      status,
      nodes: Array.isArray(nodes) ? nodes : [],
    };

    await this.helpers.httpRequestWithAuthentication.call(this, "splyntraApi", {
      method: "POST",
      url: "/v1/integrations/n8n",
      baseURL: (await this.getCredentials("splyntraApi")).baseUrl as string,
      body: payload,
      json: true,
    });

    // Pass input through unchanged so the node can sit inline.
    return [items];
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}
