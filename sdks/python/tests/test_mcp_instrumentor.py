# SPDX-License-Identifier: Apache-2.0
"""MCP instrumentor: a tool call emits a redactable tool_call span."""

import asyncio
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from opentelemetry import trace  # noqa: E402
from opentelemetry.sdk.trace import TracerProvider  # noqa: E402
from opentelemetry.sdk.trace.export import SimpleSpanProcessor  # noqa: E402
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter  # noqa: E402


def _install_fake_mcp(monkeypatch):
    """Register a minimal fake `mcp` module exposing ClientSession.call_tool."""

    class Result:
        def __init__(self):
            self.isError = False
            self.content = [types.SimpleNamespace(text="tool output")]

    class ClientSession:
        async def call_tool(self, name, arguments=None, *args, **kwargs):
            return Result()

    mod = types.ModuleType("mcp")
    mod.ClientSession = ClientSession
    monkeypatch.setitem(sys.modules, "mcp", mod)
    return ClientSession


def test_mcp_tool_call_emits_span(monkeypatch):
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    ClientSession = _install_fake_mcp(monkeypatch)

    from splyntra.instrumentors.mcp import MCPInstrumentor

    inst = MCPInstrumentor()
    # Call _instrument directly: BaseInstrumentor.instrument() gates on the mcp
    # distribution's version metadata, which a fake sys.modules entry lacks.
    inst._instrument()
    try:
        session = ClientSession()
        result = asyncio.run(session.call_tool("search_web", {"q": "splyntra"}))
        assert result.content[0].text == "tool output"
    finally:
        inst._uninstrument()

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.name == "mcp.tool.search_web"
    assert span.attributes["splyntra.span.type"] == "tool_call"
    assert span.attributes["splyntra.tool.name"] == "search_web"
    assert "splyntra" in span.attributes["splyntra.input"]
    assert span.attributes["splyntra.output"] == "tool output"
