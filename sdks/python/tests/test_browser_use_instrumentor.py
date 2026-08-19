# SPDX-License-Identifier: Apache-2.0
"""Browser Use auto-instrumentor unit test."""

import asyncio
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from opentelemetry import trace  # noqa: E402
from opentelemetry.sdk.trace import TracerProvider  # noqa: E402
from opentelemetry.sdk.trace.export import SimpleSpanProcessor  # noqa: E402
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,  # noqa: E402
)


def _install_fake_browser_use(monkeypatch):
    """Register a minimal fake `browser_use` module with Agent and Controller."""

    class Action:
        def __init__(self, name: str, params: dict):
            self.name = name
            self.params = params

        def model_dump(self):
            return {"name": self.name, "params": self.params}

    class Controller:
        async def act(self, action, *args, **kwargs):
            return f"executed {action.name}"

    class Agent:
        def __init__(self, task: str = "search repositories"):
            self.task = task
            self.n_steps = 1
            self.controller = Controller()

        async def step(self, *args, **kwargs):
            action = Action("navigate", {"url": "https://example.com"})
            return await self.controller.act(action)

        async def run(self, max_steps: int = 1):
            return await self.step()

    mod = types.ModuleType("browser_use")
    mod.Agent = Agent
    mod.Controller = Controller

    service_mod = types.ModuleType("browser_use.agent.service")
    service_mod.Agent = Agent

    ctrl_mod = types.ModuleType("browser_use.controller.service")
    ctrl_mod.Controller = Controller

    monkeypatch.setitem(sys.modules, "browser_use", mod)
    monkeypatch.setitem(sys.modules, "browser_use.agent", types.ModuleType("browser_use.agent"))
    monkeypatch.setitem(sys.modules, "browser_use.agent.service", service_mod)
    monkeypatch.setitem(sys.modules, "browser_use.controller", types.ModuleType("browser_use.controller"))
    monkeypatch.setitem(sys.modules, "browser_use.controller.service", ctrl_mod)

    return Agent, Controller


def test_browser_use_instrumentation_emits_spans(monkeypatch):
    trace._TRACER_PROVIDER = None
    if hasattr(trace, "_TRACER_PROVIDER_SET_ONCE"):
        trace._TRACER_PROVIDER_SET_ONCE._done = False
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    Agent, _ = _install_fake_browser_use(monkeypatch)

    from splyntra.instrumentors.browser_use import BrowserUseInstrumentor

    inst = BrowserUseInstrumentor()
    inst._instrument()

    try:
        agent = Agent(task="Search Python trending repositories")
        res = asyncio.run(agent.run())
        assert "executed navigate" in res
    finally:
        inst._uninstrument()

    spans = exporter.get_finished_spans()
    assert len(spans) == 3

    # Tool call span
    tool_span = next(s for s in spans if s.attributes.get("splyntra.span.type") == "tool_call")
    assert "browser." in tool_span.name
    assert tool_span.attributes["splyntra.framework"] == "browser-use"

    # Step span
    step_span = next(s for s in spans if s.attributes.get("splyntra.span.type") == "step")
    assert "browser_use.step" in step_span.name
    assert step_span.attributes["splyntra.framework"] == "browser-use"

    # Agent root span
    agent_span = next(s for s in spans if s.attributes.get("splyntra.span.type") == "agent")
    assert "browser_use.agent" in agent_span.name
    assert agent_span.attributes["splyntra.framework"] == "browser-use"
    assert agent_span.attributes["splyntra.workflow"] == "web_browsing"


def test_browser_use_tools_rename_still_traced(monkeypatch):
    """browser-use 0.3.x renamed Controller → Tools. The action-executor span must
    still fire when only the new `Tools` class (in browser_use.tools.service) is
    present, with no legacy `Controller`."""
    trace._TRACER_PROVIDER = None
    if hasattr(trace, "_TRACER_PROVIDER_SET_ONCE"):
        trace._TRACER_PROVIDER_SET_ONCE._done = False
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    class Action:
        def __init__(self, name: str):
            self.name = name

        def model_dump(self):
            return {"name": self.name}

    class Tools:
        async def act(self, action, *args, **kwargs):
            return f"executed {action.name}"

    class Agent:
        def __init__(self, task: str = "t"):
            self.task = task
            self.n_steps = 0
            self.tools = Tools()

        async def run(self, max_steps: int = 1):
            return await self.tools.act(Action("navigate"))

    mod = types.ModuleType("browser_use")
    mod.Agent = Agent  # note: NO Controller attribute
    service_mod = types.ModuleType("browser_use.agent.service")
    service_mod.Agent = Agent
    tools_mod = types.ModuleType("browser_use.tools.service")
    tools_mod.Tools = Tools

    monkeypatch.setitem(sys.modules, "browser_use", mod)
    monkeypatch.setitem(sys.modules, "browser_use.agent", types.ModuleType("browser_use.agent"))
    monkeypatch.setitem(sys.modules, "browser_use.agent.service", service_mod)
    monkeypatch.setitem(sys.modules, "browser_use.tools", types.ModuleType("browser_use.tools"))
    monkeypatch.setitem(sys.modules, "browser_use.tools.service", tools_mod)

    from splyntra.instrumentors.browser_use import BrowserUseInstrumentor

    inst = BrowserUseInstrumentor()
    inst._instrument()
    try:
        assert "executed navigate" in asyncio.run(Agent().run())
    finally:
        inst._uninstrument()

    spans = exporter.get_finished_spans()
    tool_spans = [s for s in spans if s.attributes.get("splyntra.span.type") == "tool_call"]
    assert len(tool_spans) == 1
    assert "browser." in tool_spans[0].name
