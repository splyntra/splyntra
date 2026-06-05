# SPDX-License-Identifier: Apache-2.0
"""Framework auto-instrumentors for Splyntra.

Each instrumentor patches a framework to emit OpenTelemetry spans that flow
through the same SDK pipeline (and thus the same redaction + export path) as
manually-decorated code.

Quick start::

    import splyntra
    splyntra.Splyntra(api_key="...", project="my-app", instrument=("langgraph", "openai"))

    # or, after configuring the client:
    from splyntra.instrumentors import instrument
    instrument()            # auto-detect installed frameworks
    instrument("langgraph") # enable a specific one
"""

from __future__ import annotations

from importlib.util import find_spec
from typing import Dict, List, Type

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor

from splyntra.instrumentors.openai import OpenAIInstrumentor
from splyntra.instrumentors.langgraph import LangGraphInstrumentor
from splyntra.instrumentors.openai_agents import OpenAIAgentsInstrumentor
from splyntra.instrumentors.crewai import CrewAIInstrumentor

__all__ = [
    "OpenAIInstrumentor",
    "LangGraphInstrumentor",
    "OpenAIAgentsInstrumentor",
    "CrewAIInstrumentor",
    "instrument",
]

# Public framework name -> instrumentor class.
_REGISTRY: Dict[str, Type[BaseInstrumentor]] = {
    "openai": OpenAIInstrumentor,
    "langgraph": LangGraphInstrumentor,
    "openai-agents": OpenAIAgentsInstrumentor,
    "openai_agents": OpenAIAgentsInstrumentor,
    "crewai": CrewAIInstrumentor,
}

# Framework name -> importable module used for auto-detection.
_DETECT = {
    "openai": "openai",
    "langgraph": "langgraph",
    "openai-agents": "agents",
    "crewai": "crewai",
}


def instrument(*frameworks: str) -> List[str]:
    """Enable instrumentors. With no arguments, auto-detects and enables every
    framework whose package is importable. Returns the list of names enabled.
    """
    if frameworks:
        names = list(frameworks)
    else:
        names = [name for name, module in _DETECT.items() if find_spec(module) is not None]

    enabled: List[str] = []
    seen = set()
    for name in names:
        cls = _REGISTRY.get(name)
        if cls is None or cls in seen:
            continue
        seen.add(cls)
        instrumentor = cls()
        if not instrumentor.is_instrumented_by_opentelemetry:
            instrumentor.instrument()
        enabled.append(name)
    return enabled
