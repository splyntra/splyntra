# SPDX-License-Identifier: FSL-1.1-ALv2
"""Splyntra + CrewAI Quickstart
=================================
Auto-instrument a CrewAI crew — every crew kickoff, task, and tool call becomes
a nested Splyntra span, annotated with risk scores.

Prerequisites:
    docker compose up -d
    pip install "splyntra[crewai,openai]" crewai

Run:
    export OPENAI_API_KEY=sk-...
    python examples/crewai_quickstart.py

Then open http://localhost:3000/traces.
"""

from splyntra import Splyntra

# 1. Initialize Splyntra and auto-instrument CrewAI (+ OpenAI for LLM spans).
Splyntra(
    api_key="splyntra_dev_key",
    project="crewai-demo",
    framework="crewai",
    instrument=("crewai", "openai"),
)

# 2. Build a normal CrewAI crew — no Splyntra-specific code below this line.
from crewai import Agent, Crew, Task  # noqa: E402

researcher = Agent(
    role="Researcher",
    goal="Find concise, accurate information",
    backstory="An expert research assistant.",
    verbose=False,
)

task = Task(
    description="Summarize the benefits of agent observability in two sentences.",
    expected_output="A two-sentence summary.",
    agent=researcher,
)

crew = Crew(agents=[researcher], tasks=[task], verbose=False)

if __name__ == "__main__":
    result = crew.kickoff()
    print(f"Result: {result}")
    print("\n✓ Trace sent! View at http://localhost:3000/traces")
