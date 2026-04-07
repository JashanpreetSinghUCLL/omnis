"""Shared mutable state for the LangGraph agent graph.

Every node receives the full AgentState and returns a dict containing only
the fields it updates. LangGraph merges these partial updates into the
running state automatically.
"""

from __future__ import annotations

from typing import Literal, TypedDict

MAX_RETRIES: int = 3


class AgentState(TypedDict):
    """Full mutable state threaded through every node in the agent graph."""

    # ── Input
    question: str
    session_id: str
    tenant_id: str
    force_model: str | None  # optional user-selected model override

    # ── Routing
    route: Literal["researcher", "coder"] | None  # set by classifier_node
    model_used: str  # logged per query for cost tracking

    # ── Retrieval
    context: list[dict[str, object]]  # retrieved chunks {text, score, source, chunk_id}
    citations: list[dict[str, object]]  # {index, source, chunk_id, score}
    memory_facts: list[str]  # recalled prior-turn facts (Graphiti)

    # ── Generation
    code_snippet: str | None  # populated by coder_node when route == "coder"
    final_answer: str | None  # set by researcher_node; confirmed/updated by reviewer

    # ── Feedback loop
    errors: list[str]  # reviewer critique; passed to coder on retry
    faithfulness_score: float | None
    retry_count: int  # hard ceiling enforced in graph.py: MAX_RETRIES = 3

    # ── Per-node timing (ms) — written by each node, read by the SSE route
    latency_ms: float | None
