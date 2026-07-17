# SPDX-License-Identifier: FSL-1.1-ALv2
"""
Splyntra + LangGraph Quickstart
===============================
Time-to-first-trace in under five minutes on LangGraph — the DoD #1 path.

One line of Splyntra setup auto-instruments LangGraph (graph runs become
`agent` spans, nodes become `step` spans) and OpenAI (LLM calls become
`llm_call` spans). No per-node code changes.

Prerequisites:
    docker compose up -d                       # start Splyntra
    pip install "splyntra[langgraph,openai]" langchain-openai

Run:
    python examples/langgraph_quickstart.py

Then open http://localhost:3000/traces to see the nested trace + risk score.
"""

from typing import TypedDict

from splyntra import Splyntra

# 1. One line: configure Splyntra and auto-instrument LangGraph + OpenAI.
splyntra = Splyntra(
    api_key="splyntra_dev_key",
    project="langgraph-demo",
    framework="langgraph",
    instrument=("langgraph", "openai"),
)


# 2. Build a tiny LangGraph agent.
class State(TypedDict):
    query: str
    plan: str
    answer: str


def plan_node(state: State) -> State:
    # In production this would call an LLM (auto-traced by the openai instrumentor).
    return {**state, "plan": f"research: {state['query']}"}


def answer_node(state: State) -> State:
    return {**state, "answer": f"Summary for '{state['query']}' based on {state['plan']}"}


def build_graph():
    from langgraph.graph import StateGraph, END

    g = StateGraph(State)
    g.add_node("plan", plan_node)
    g.add_node("answer", answer_node)
    g.set_entry_point("plan")
    g.add_edge("plan", "answer")
    g.add_edge("answer", END)
    return g.compile()


# 3. Run it.
if __name__ == "__main__":
    try:
        graph = build_graph()
    except ImportError:
        raise SystemExit(
            "LangGraph is not installed. Run:\n"
            '    pip install "splyntra[langgraph,openai]" langchain-openai'
        )

    print("Running LangGraph agent...")
    result = graph.invoke({"query": "AI agent observability"})
    print(f"Answer: {result['answer']}")
    print("\n✓ Trace sent! View at http://localhost:3000/traces")

    splyntra.shutdown()
