# SPDX-License-Identifier: Apache-2.0
"""MCP (Model Context Protocol) instrumentor — traces MCP tool calls made through
the ``mcp`` client SDK's ``ClientSession``.

MCP is the connective tissue between agents and their tools/servers in 2026; a
``tools/call`` becomes a ``tool_call`` span (child of the surrounding agent span),
carrying the tool name, the MCP server/transport, and redacted args/result — so
it lands in the same trace waterfall and feeds the same detectors (incl. the
dangerous-tool-call detector) as any other tool call.
"""

from __future__ import annotations

import json
import time
from typing import Collection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry import trace
from opentelemetry.trace import StatusCode


def _client_session():
    """Return the mcp ClientSession class across layouts, or None if absent."""
    try:
        from mcp import ClientSession  # re-exported at the top level

        return ClientSession
    except Exception:
        try:
            from mcp.client.session import ClientSession

            return ClientSession
        except Exception:
            return None


def _stringify(result) -> str:
    """Best-effort text extraction from an MCP CallToolResult."""
    content = getattr(result, "content", None)
    if isinstance(content, list):
        parts = [getattr(b, "text", None) for b in content]
        texts = [p for p in parts if isinstance(p, str)]
        if texts:
            return "\n".join(texts)
    try:
        return json.dumps(result, default=str)[:8192]
    except Exception:
        return str(result)[:8192]


class MCPInstrumentor(BaseInstrumentor):
    """Instruments the MCP Python SDK to emit a span per tool call.

    Usage:
        from splyntra.instrumentors import MCPInstrumentor
        MCPInstrumentor().instrument()
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return ("mcp >= 1.0.0",)

    def _instrument(self, **kwargs):
        ClientSession = _client_session()
        if ClientSession is None:
            return

        tracer = trace.get_tracer("splyntra.mcp")

        # Patch initialize() to stash the server's name on the session, so every
        # tool call can be attributed to its MCP server (per-server monitoring).
        orig_init = getattr(ClientSession, "initialize", None)
        if orig_init is not None and not getattr(orig_init, "__splyntra_wrapped", False):
            async def patched_init(self_session, *a, **k):
                result = await orig_init(self_session, *a, **k)
                try:
                    self_session.__splyntra_server = getattr(getattr(result, "serverInfo", None), "name", "") or ""
                except Exception:
                    pass
                return result
            patched_init.__splyntra_wrapped = True
            ClientSession.initialize = patched_init
            self._orig_init = orig_init

        orig = getattr(ClientSession, "call_tool", None)
        if orig is None or getattr(orig, "__splyntra_wrapped", False):
            return

        async def patched(self_session, name, arguments=None, *args, **kwargs):
            server = getattr(self_session, "__splyntra_server", "") or ""
            span = tracer.start_span(
                f"mcp.tool.{name}",
                kind=trace.SpanKind.CLIENT,
                attributes={
                    "splyntra.span.type": "tool_call",
                    "splyntra.tool.name": name,
                    "mcp.method": "tools/call",
                    "mcp.server.name": server,
                },
            )
            if arguments is not None:
                try:
                    span.set_attribute("splyntra.input", json.dumps(arguments, default=str)[:8192])
                except Exception:
                    pass
            start = time.time()
            try:
                result = await orig(self_session, name, arguments, *args, **kwargs)
                span.set_attribute("splyntra.tool.duration_ms", (time.time() - start) * 1000)
                span.set_attribute("splyntra.output", _stringify(result))
                if getattr(result, "isError", False):
                    span.set_status(StatusCode.ERROR, "MCP tool reported an error")
                else:
                    span.set_status(StatusCode.OK)
                span.end()
                return result
            except Exception as e:
                span.set_status(StatusCode.ERROR, str(e))
                span.record_exception(e)
                span.end()
                raise

        patched.__splyntra_wrapped = True
        ClientSession.call_tool = patched
        self._orig = orig

    def _uninstrument(self, **kwargs):
        ClientSession = _client_session()
        if ClientSession is not None and hasattr(self, "_orig"):
            ClientSession.call_tool = self._orig
        if ClientSession is not None and hasattr(self, "_orig_init"):
            ClientSession.initialize = self._orig_init
