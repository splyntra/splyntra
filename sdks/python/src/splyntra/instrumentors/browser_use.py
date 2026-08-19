# SPDX-License-Identifier: Apache-2.0
"""Browser Use auto-instrumentor — instruments browser-use agents, steps, and browser tool actions.

Emits:
- A root ``agent`` span for ``Agent.run()``
- A ``step`` span for each ``Agent.step()``
- A ``tool_call`` span for each browser controller action (navigate, click, type, extract, screenshot)
"""

from __future__ import annotations

import functools
import time
from typing import Any, Collection

from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.trace import StatusCode

_FRAMEWORK = "browser-use"


class BrowserUseInstrumentor(BaseInstrumentor):
    """Instruments browser-use Agent execution and controller actions.

    Usage:
        from splyntra.instrumentors import BrowserUseInstrumentor
        BrowserUseInstrumentor().instrument()
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        from importlib.util import find_spec

        if find_spec("browser_use") is not None:
            return ("browser-use >= 0.1.0",)
        return ()

    def _instrument(self, **kwargs):
        tracer = trace.get_tracer("splyntra.browser_use")
        self._patched: list[tuple[Any, str, Any]] = []

        # 1. Patch Agent.run (async)
        self._patch_agent_run(tracer)

        # 2. Patch Agent.step (async)
        self._patch_agent_step(tracer)

        # 3. Patch Controller actions
        self._patch_controller_act(tracer)

    def _patch_agent_run(self, tracer: trace.Tracer):
        try:
            from browser_use.agent.service import Agent
        except Exception:  # noqa: BLE001
            try:
                from browser_use import Agent
            except Exception:  # noqa: BLE001
                return

        original = getattr(Agent, "run", None)
        if original is None or getattr(original, "_splyntra_wrapped", False):
            return

        @functools.wraps(original)
        async def wrapped_run(self_agent, *args, **kwargs):
            task_desc = getattr(self_agent, "task", None) or "browser_task"
            span_name = f"browser_use.agent:{task_desc[:40]}" if isinstance(task_desc, str) else "browser_use.agent"

            with tracer.start_as_current_span(
                span_name,
                kind=trace.SpanKind.INTERNAL,
                attributes={
                    "splyntra.span.type": "agent",
                    "splyntra.framework": _FRAMEWORK,
                    "splyntra.agent.name": "browser_agent",
                    "splyntra.workflow": "web_browsing",
                    "browser.task": str(task_desc)[:500],
                },
            ) as span:
                start = time.perf_counter()
                try:
                    history = await original(self_agent, *args, **kwargs)
                    span.set_attribute("splyntra.tool.duration_ms", (time.perf_counter() - start) * 1000)
                    span.set_status(StatusCode.OK)
                    return history
                except Exception as e:  # noqa: BLE001
                    span.set_status(StatusCode.ERROR, str(e))
                    span.record_exception(e)
                    raise

        setattr(wrapped_run, "_splyntra_wrapped", True)
        setattr(Agent, "run", wrapped_run)
        self._patched.append((Agent, "run", original))

    def _patch_agent_step(self, tracer: trace.Tracer):
        try:
            from browser_use.agent.service import Agent
        except Exception:  # noqa: BLE001
            try:
                from browser_use import Agent
            except Exception:  # noqa: BLE001
                return

        original = getattr(Agent, "step", None)
        if original is None or getattr(original, "_splyntra_wrapped", False):
            return

        @functools.wraps(original)
        async def wrapped_step(self_agent, *args, **kwargs):
            step_num = getattr(self_agent, "n_steps", 0)
            span_name = f"browser_use.step_{step_num}"

            with tracer.start_as_current_span(
                span_name,
                kind=trace.SpanKind.INTERNAL,
                attributes={
                    "splyntra.span.type": "step",
                    "splyntra.framework": _FRAMEWORK,
                    "splyntra.step.name": span_name,
                    "browser.step_number": step_num,
                },
            ) as span:
                start = time.perf_counter()
                try:
                    result = await original(self_agent, *args, **kwargs)
                    span.set_attribute("splyntra.tool.duration_ms", (time.perf_counter() - start) * 1000)
                    span.set_status(StatusCode.OK)
                    return result
                except Exception as e:  # noqa: BLE001
                    span.set_status(StatusCode.ERROR, str(e))
                    span.record_exception(e)
                    raise

        setattr(wrapped_step, "_splyntra_wrapped", True)
        setattr(Agent, "step", wrapped_step)
        self._patched.append((Agent, "step", original))

    def _resolve_tool_classes(self) -> list:
        """Resolve the action-executor class across browser-use versions.

        browser-use renamed ``Controller`` → ``Tools`` in 0.3.x (``Controller`` is
        kept as a backward-compatible alias in most releases). We patch whichever
        class(es) are importable so ``tool_call`` spans keep flowing on both the
        legacy and current API — de-duped by identity so an alias isn't wrapped
        twice.
        """
        import importlib

        candidates = (
            ("browser_use.controller.service", "Controller"),
            ("browser_use.tools.service", "Tools"),
            ("browser_use", "Controller"),
            ("browser_use", "Tools"),
        )
        seen: set[int] = set()
        classes: list = []
        for module_name, attr in candidates:
            try:
                mod = importlib.import_module(module_name)
            except Exception:  # noqa: BLE001
                continue
            cls = getattr(mod, attr, None)
            if cls is not None and id(cls) not in seen:
                seen.add(id(cls))
                classes.append(cls)
        return classes

    def _patch_controller_act(self, tracer: trace.Tracer):
        tool_classes = self._resolve_tool_classes()
        if not tool_classes:
            return

        def make_wrapper(orig):
            @functools.wraps(orig)
            async def wrapped_act(self_ctrl, action, *args, **kwargs):
                action_name = getattr(action, "__class__", type(action)).__name__
                if hasattr(action, "model_dump"):
                    action_data = str(action.model_dump())[:400]
                else:
                    action_data = str(action)[:400]

                span_name = f"browser.{action_name.lower()}"
                with tracer.start_as_current_span(
                    span_name,
                    kind=trace.SpanKind.INTERNAL,
                    attributes={
                        "splyntra.span.type": "tool_call",
                        "splyntra.tool.name": span_name,
                        "splyntra.framework": _FRAMEWORK,
                        "splyntra.input": action_data,
                    },
                ) as span:
                    start = time.perf_counter()
                    try:
                        res = await orig(self_ctrl, action, *args, **kwargs)
                        span.set_attribute("splyntra.tool.duration_ms", (time.perf_counter() - start) * 1000)
                        if res is not None:
                            span.set_attribute("splyntra.output", str(res)[:1000])
                        span.set_status(StatusCode.OK)
                        return res
                    except Exception as e:  # noqa: BLE001
                        span.set_status(StatusCode.ERROR, str(e))
                        span.record_exception(e)
                        raise

            return wrapped_act

        for cls in tool_classes:
            for method in ("act", "multi_act"):
                original = cls.__dict__.get(method)
                if original is None or getattr(original, "_splyntra_wrapped", False):
                    continue

                wrapped = make_wrapper(original)
                setattr(wrapped, "_splyntra_wrapped", True)
                setattr(cls, method, wrapped)
                self._patched.append((cls, method, original))

    def _uninstrument(self, **kwargs):
        for target, attr, original in getattr(self, "_patched", []):
            setattr(target, attr, original)
        self._patched = []
