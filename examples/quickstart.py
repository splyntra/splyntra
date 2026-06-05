# SPDX-License-Identifier: AGPL-3.0-only
"""
Splyntra Quickstart Example
============================
Demonstrates time-to-first-trace in under 5 minutes.

Prerequisites:
    docker compose up -d   # Start Splyntra
    pip install splyntra   # Install SDK

Run:
    python quickstart.py
    
Then open http://localhost:3000/traces to see your trace.
"""

from splyntra import Splyntra, trace_agent, trace_tool, trace_llm

# 1. Initialize Splyntra (one line)
splyntra = Splyntra(
    api_key="splyntra_dev_key",
    project="quickstart-demo",
)


# 2. Instrument your agent
@trace_agent(name="research_agent", workflow="summarize")
def research_agent(query: str) -> str:
    """A simple agent that searches and summarizes."""
    # Step 1: Plan
    plan = plan_research(query)

    # Step 2: Search
    results = search_web(plan["search_query"])

    # Step 3: Summarize
    summary = summarize(results)

    return summary


@trace_llm(model="gpt-4o", provider="openai")
def plan_research(query: str) -> dict:
    """Simulate an LLM planning step."""
    # In production, this calls your LLM
    import time
    time.sleep(0.1)  # Simulate latency
    return {
        "search_query": f"latest research on {query}",
        "usage": {"prompt_tokens": 150, "completion_tokens": 45},
    }


@trace_tool(name="web.search")
def search_web(query: str) -> list:
    """Simulate a tool call."""
    import time
    time.sleep(0.2)  # Simulate API call
    return [
        {"title": "Result 1", "snippet": "Relevant information..."},
        {"title": "Result 2", "snippet": "More details..."},
    ]


@trace_llm(model="gpt-4o-mini", provider="openai")
def summarize(results: list) -> dict:
    """Simulate summarization."""
    import time
    time.sleep(0.15)
    return {
        "content": "Here is a summary of the research findings...",
        "usage": {"prompt_tokens": 320, "completion_tokens": 88},
    }


# 3. Run it
if __name__ == "__main__":
    print("Running research agent...")
    result = research_agent("AI agent observability")
    print(f"Result: {result}")
    print("\n✓ Trace sent! View at http://localhost:3000/traces")

    # Clean shutdown
    splyntra.shutdown()
