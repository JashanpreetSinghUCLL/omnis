"""LangGraph StateGraph assembly for the Omnis multi-agent orchestrator.

Graph topology
--------------

        START
          |
          v
  classifier -------------------------------------------------------+
          |                                                             |
          v (always)                                                    |
  researcher -[route=coder]--> coder -----------------------------> |
          |                          ^                                  |
          |[route=researcher]        | (fail, retry < MAX_RETRIES)     |
          +------------------------->|                                  |
                              reviewer
                                  |
              [score >= 0.85] --> END
              [retry >= MAX]  --> degradation --> END

        (all paths exit at END)
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from langgraph.graph import END, START, StateGraph

from agents.nodes import (
    FAITHFULNESS_THRESHOLD,
    EmbedFn,
    degradation_node,
    make_classifier_node,
    make_coder_node,
    make_researcher_node,
    make_reviewer_node,
)
from agents.state import MAX_RETRIES, AgentState
from retrieval.pipeline import HybridRetriever

logger = logging.getLogger(__name__)


def _after_researcher(state: AgentState) -> str:
    """After researcher: route to coder if the question needs code; else to reviewer."""
    return "coder" if state.get("route") == "coder" else "reviewer"


def _after_reviewer(state: AgentState) -> str:
    """After reviewer: pass -> end; fail+retry<MAX -> coder; fail+retry>=MAX -> degrade."""
    score = state.get("faithfulness_score") or 0.0
    retry = int(state.get("retry_count") or 0)
    errors = state.get("errors", [])
    if score >= FAITHFULNESS_THRESHOLD:
        logger.info(
            "Graph transition | reviewer=end score=%.2f retry=%d errors=%d",
            score,
            retry,
            len(errors),
        )
        return "end"
    if retry < MAX_RETRIES:
        logger.info(
            "Graph transition | reviewer=retry score=%.2f retry=%d errors=%d",
            score,
            retry,
            len(errors),
        )
        return "retry"
    logger.info(
        "Graph transition | reviewer=degrade score=%.2f retry=%d errors=%d",
        score,
        retry,
        len(errors),
    )
    return "degrade"


def build_graph(
    anthropic_api_key: str,
    qdrant_url: str = "http://localhost:6333",
    qdrant_api_key: str | None = None,
    neo4j_uri: str = "bolt://localhost:7687",
    neo4j_user: str = "neo4j",
    neo4j_password: str = "omnis_dev_password",
    cohere_api_key: str | None = None,
    embed_fn: EmbedFn | None = None,
    retriever: HybridRetriever | None = None,
) -> Callable[[AgentState], Awaitable[AgentState]]:
    """Compile and return the agent StateGraph."""
    if retriever is None:
        retriever = HybridRetriever(
            qdrant_url=qdrant_url,
            qdrant_api_key=qdrant_api_key,
            neo4j_uri=neo4j_uri,
            neo4j_user=neo4j_user,
            neo4j_password=neo4j_password,
            cohere_api_key=cohere_api_key,
        )

    if embed_fn is None:

        async def _zero_embed(text: str) -> list[float]:
            await asyncio.sleep(0)
            return [0.0] * 1024

        embed_fn = _zero_embed

    classifier = make_classifier_node()
    researcher = make_researcher_node(retriever, embed_fn, anthropic_api_key)
    coder = make_coder_node(anthropic_api_key)
    reviewer = make_reviewer_node(anthropic_api_key)

    builder: StateGraph = StateGraph(AgentState)

    builder.add_node("classifier", classifier)
    builder.add_node("researcher", researcher)
    builder.add_node("coder", coder)
    builder.add_node("reviewer", reviewer)
    builder.add_node("degradation", degradation_node)

    builder.add_edge(START, "classifier")
    builder.add_edge("classifier", "researcher")

    builder.add_conditional_edges(
        "researcher",
        _after_researcher,
        {"coder": "coder", "reviewer": "reviewer"},
    )

    builder.add_edge("coder", "reviewer")

    builder.add_conditional_edges(
        "reviewer",
        _after_reviewer,
        {"end": END, "retry": "coder", "degrade": "degradation"},
    )

    builder.add_edge("degradation", END)

    compiled = builder.compile()
    logger.info("Agent graph compiled successfully")
    return compiled  # type: ignore[return-value]
