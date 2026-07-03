// SPDX-License-Identifier: Apache-2.0
import { trace, SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";
import { patchDual, pick } from "./patch";

/**
 * Auto-instrument the MCP (Model Context Protocol) TypeScript SDK
 * (`@modelcontextprotocol/sdk`). Patches `Client.prototype.callTool` so every
 * `tools/call` emits a `tool_call` span with the tool name, MCP method, and
 * redacted args/result — landing in the same trace waterfall (and feeding the
 * same detectors) as any other tool call. Best-effort: a safe no-op when the
 * package is absent or its internals move. Patches both CJS and ESM (see ./patch).
 *
 * Returns true if the synchronous CJS patch was applied.
 */
export function instrumentMCP(): boolean {
  return patchDual(
    ["@modelcontextprotocol/sdk/client/index.js", "@modelcontextprotocol/sdk"],
    patchMCP
  );
}

function patchMCP(mod: unknown): boolean {
  const Client = pick(mod, "Client") as { prototype?: Record<string, unknown> } | undefined;
  const proto = Client?.prototype;
  if (!proto || typeof proto.callTool !== "function" || (proto.callTool as { __splyntraWrapped?: boolean }).__splyntraWrapped) {
    return false;
  }

  const original = proto.callTool as (...args: unknown[]) => unknown;
  function patched(this: any, params: any, ...rest: unknown[]) {
    const name = (params && params.name) || "unknown";
    // Attribute each call to its MCP server for per-server monitoring.
    let server = "";
    try {
      server = this?.getServerVersion?.()?.name || "";
    } catch {
      /* server info not available yet */
    }
    const tracer = trace.getTracer("splyntra.mcp");
    return tracer.startActiveSpan(
      `mcp.tool.${name}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "splyntra.span.type": "tool_call",
          "splyntra.tool.name": name,
          "mcp.method": "tools/call",
          "mcp.server.name": server,
        },
      },
      (span: Span) => {
        if (params?.arguments !== undefined) {
          try {
            span.setAttribute("splyntra.input", JSON.stringify(params.arguments).slice(0, 8192));
          } catch {
            /* non-serializable args */
          }
        }
        const start = Date.now();
        let result: any;
        try {
          result = original.call(this, params, ...rest);
        } catch (err: any) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
          span.recordException(err);
          span.end();
          throw err;
        }
        return Promise.resolve(result)
          .then((res: any) => {
            span.setAttribute("splyntra.tool.duration_ms", Date.now() - start);
            const content = res?.content;
            if (Array.isArray(content)) {
              const text = content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("\n").trim();
              if (text) span.setAttribute("splyntra.output", text.slice(0, 8192));
            }
            span.setStatus({ code: res?.isError ? SpanStatusCode.ERROR : SpanStatusCode.OK });
            span.end();
            return res;
          })
          .catch((err: any) => {
            span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
            span.recordException(err);
            span.end();
            throw err;
          });
      }
    );
  }
  (patched as any).__splyntraWrapped = true;
  proto.callTool = patched;
  return true;
}
