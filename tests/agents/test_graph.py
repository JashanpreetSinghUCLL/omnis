"""Unit tests for the Sprint 4 multi-agent graph.

All LLM and retriever calls are mocked so these run without external services.

Test coverage
-------------
- Router: keyword → model mapping
- Classifier node: sets route + model_used
- Graph: compiles without errors
- Happy path (researcher): retrieval → answer → reviewer passes → END
- Happy path (coder): retrieval → code generation → reviewer passes → END
- Retry loop: reviewer fails once, then passes → retry_count=1 at END
- Graceful degradation: reviewer always fails → MAX_RETRIES reached → degradation msg
- Citations: researcher_node attaches citations to state
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.graph import _after_researcher, _after_reviewer, build_graph
from agents.nodes import (
    FAITHFULNESS_THRESHOLD,
    make_classifier_node,
)
from agents.router import HAIKU, OPUS, SONNET, route_question
from agents.state import MAX_RETRIES, AgentState


# ── Helpers


def _base_state(**overrides: object) -> AgentState:
    state: AgentState = {
        "question": "What is the Gateway?",
        "session_id": "test-session",
        "tenant_id": "default",
        "route": None,
        "model_used": "",
        "context": [],
        "citations": [],
        "code_snippet": None,
        "final_answer": None,
        "errors": [],
        "faithfulness_score": None,
        "retry_count": 0,
    }
    state.update(overrides)  # type: ignore[typeddict-item]
    return state


def _fake_ranked_result(
    text: str = "The Gateway manages connections.", source: str = "ch1.pdf"
) -> MagicMock:
    fused = MagicMock()
    fused.text = text
    fused.source = source
    fused.id = "chunk-001"
    ranked = MagicMock()
    ranked.fused = fused
    ranked.rerank_score = 0.9
    return ranked


def _fake_retrieval_result(*texts: str) -> MagicMock:
    result = MagicMock()
    result.ranked = (
        [_fake_ranked_result(t) for t in texts] if texts else [_fake_ranked_result()]
    )
    return result


# ── Router tests


def test_router_code_keyword() -> None:
    r = route_question("Write a Python function to read tag values")
    assert r.route == "coder"
    assert r.model_id == SONNET


def test_router_simple_question() -> None:
    r = route_question("What is the Gateway?")
    assert r.route == "researcher"
    assert r.model_id == HAIKU


def test_router_complex_question() -> None:
    r = route_question("Compare the pros and cons of OPC-UA vs Modbus")
    assert r.route == "researcher"
    assert r.model_id == OPUS


def test_router_generate_keyword() -> None:
    r = route_question("Generate a script to poll all device tags")
    assert r.route == "coder"


def test_router_analyze_keyword() -> None:
    r = route_question("Analyze the difference between two SCADA architectures")
    assert r.route == "researcher"
    assert r.model_id == OPUS


# ── Classifier node


@pytest.mark.asyncio
async def test_classifier_code_route() -> None:
    node = make_classifier_node()
    result = await node(_base_state(question="Write a function to log alarms"))
    assert result["route"] == "coder"
    assert result["model_used"] == SONNET


@pytest.mark.asyncio
async def test_classifier_researcher_route() -> None:
    node = make_classifier_node()
    result = await node(_base_state(question="What does the Tag Provider do?"))
    assert result["route"] == "researcher"


@pytest.mark.asyncio
async def test_classifier_complex_route_uses_opus() -> None:
    node = make_classifier_node()
    result = await node(
        _base_state(question="Compare the architecture of Ignition vs FactoryTalk")
    )
    assert result["model_used"] == OPUS


# ── Conditional edge functions


def test_after_researcher_coder_route() -> None:
    assert _after_researcher(_base_state(route="coder")) == "coder"


def test_after_researcher_researcher_route() -> None:
    assert _after_researcher(_base_state(route="researcher")) == "reviewer"


def test_after_reviewer_pass() -> None:
    state = _base_state(faithfulness_score=0.90, retry_count=0)
    assert _after_reviewer(state) == "end"


def test_after_reviewer_retry() -> None:
    state = _base_state(faithfulness_score=0.60, retry_count=1)
    assert _after_reviewer(state) == "retry"


def test_after_reviewer_degrade_at_ceiling() -> None:
    state = _base_state(faithfulness_score=0.50, retry_count=MAX_RETRIES)
    assert _after_reviewer(state) == "degrade"


def test_after_reviewer_threshold_boundary() -> None:
    """Score exactly at threshold should pass."""
    state = _base_state(faithfulness_score=FAITHFULNESS_THRESHOLD, retry_count=0)
    assert _after_reviewer(state) == "end"


# ── Graph compilation


def test_graph_compiles() -> None:
    """build_graph must not raise when given a mock retriever + embed_fn."""
    mock_retriever = MagicMock()
    mock_embed: AsyncMock = AsyncMock(return_value=[0.0] * 10)
    graph = build_graph(
        anthropic_api_key="test-key",
        embed_fn=mock_embed,
        retriever=mock_retriever,
    )
    assert graph is not None


# ── Full graph (mocked LLM)


@pytest.mark.asyncio
async def test_happy_path_researcher() -> None:
    """Researcher route: retrieval → answer → reviewer passes → END."""
    mock_retriever = AsyncMock()
    mock_retriever.retrieve.return_value = _fake_retrieval_result(
        "The Gateway manages connections."
    )

    mock_embed: AsyncMock = AsyncMock(return_value=[0.0] * 10)
    mock_llm = AsyncMock()
    mock_llm.ainvoke.side_effect = [
        MagicMock(content="The Gateway manages device connections [1]."),  # researcher
        MagicMock(content='{"score": 0.95, "issues": []}'),  # reviewer
    ]

    with patch("agents.nodes.ChatAnthropic", return_value=mock_llm):
        graph = build_graph(
            anthropic_api_key="test-key",
            embed_fn=mock_embed,
            retriever=mock_retriever,
        )
        result = await graph.ainvoke(_base_state(question="What is the Gateway?"))

    assert result["final_answer"] is not None
    assert "Gateway" in result["final_answer"]
    assert (result["faithfulness_score"] or 0.0) >= FAITHFULNESS_THRESHOLD
    assert result["retry_count"] == 0
    assert len(result["citations"]) > 0


@pytest.mark.asyncio
async def test_happy_path_coder() -> None:
    """Coder route: retrieval → code gen → reviewer passes → END."""
    mock_retriever = AsyncMock()
    mock_retriever.retrieve.return_value = _fake_retrieval_result(
        "system.tag.read(tagPath)"
    )

    mock_embed: AsyncMock = AsyncMock(return_value=[0.0] * 10)
    mock_llm = AsyncMock()
    mock_llm.ainvoke.side_effect = [
        MagicMock(content="Here is context on tag reading [1]."),  # researcher answer
        MagicMock(content="value = system.tag.read('[default]MyTag')"),  # coder
        MagicMock(content='{"score": 0.91, "issues": []}'),  # reviewer
    ]

    with patch("agents.nodes.ChatAnthropic", return_value=mock_llm):
        graph = build_graph(
            anthropic_api_key="test-key",
            embed_fn=mock_embed,
            retriever=mock_retriever,
        )
        result = await graph.ainvoke(_base_state(question="Write code to read a tag"))

    assert result["code_snippet"] is not None
    assert result["final_answer"] is not None
    assert (result["faithfulness_score"] or 0.0) >= FAITHFULNESS_THRESHOLD


@pytest.mark.asyncio
async def test_retry_loop_triggers_and_passes() -> None:
    """Reviewer fails once, coder improves, reviewer passes on second attempt."""
    mock_retriever = AsyncMock()
    mock_retriever.retrieve.return_value = _fake_retrieval_result()

    mock_embed: AsyncMock = AsyncMock(return_value=[0.0] * 10)
    mock_llm = AsyncMock()
    mock_llm.ainvoke.side_effect = [
        MagicMock(content="Initial answer [1]."),  # researcher
        MagicMock(
            content='{"score": 0.60, "issues": ["claim not supported"]}'
        ),  # reviewer fail
        MagicMock(content="Improved answer strictly from context [1]."),  # coder
        MagicMock(content='{"score": 0.92, "issues": []}'),  # reviewer pass
    ]

    with patch("agents.nodes.ChatAnthropic", return_value=mock_llm):
        graph = build_graph(
            anthropic_api_key="test-key",
            embed_fn=mock_embed,
            retriever=mock_retriever,
        )
        result = await graph.ainvoke(_base_state(question="What does SCADA stand for?"))

    assert result["retry_count"] == 1
    assert (result["faithfulness_score"] or 0.0) >= FAITHFULNESS_THRESHOLD
    assert result["final_answer"] is not None


@pytest.mark.asyncio
async def test_graceful_degradation_on_max_retries() -> None:
    """Reviewer always fails → MAX_RETRIES reached → degradation message in final_answer."""
    mock_retriever = AsyncMock()
    mock_retriever.retrieve.return_value = _fake_retrieval_result()

    mock_embed: AsyncMock = AsyncMock(return_value=[0.0] * 10)
    # Pattern: researcher, then alternating reviewer/coder failures until MAX_RETRIES.
    # For MAX_RETRIES=3 this is 8 LLM calls total:
    # researcher, reviewer1, coder1, reviewer2, coder2, reviewer3, coder3, reviewer4.
    llm_responses = [
        MagicMock(content="Answer."),  # researcher
        MagicMock(content='{"score": 0.50, "issues": ["x"]}'),  # reviewer fail 1
        MagicMock(content="Retry 1."),  # coder retry 1
        MagicMock(content='{"score": 0.50, "issues": ["x"]}'),  # reviewer fail 2
        MagicMock(content="Retry 2."),  # coder retry 2
        MagicMock(content='{"score": 0.50, "issues": ["x"]}'),  # reviewer fail 3
        MagicMock(content="Retry 3."),  # coder retry 3
        MagicMock(
            content='{"score": 0.50, "issues": ["x"]}'
        ),  # reviewer fail 4 → degrade
    ]
    mock_llm = AsyncMock()
    mock_llm.ainvoke.side_effect = llm_responses

    with patch("agents.nodes.ChatAnthropic", return_value=mock_llm):
        graph = build_graph(
            anthropic_api_key="test-key",
            embed_fn=mock_embed,
            retriever=mock_retriever,
        )
        result = await graph.ainvoke(_base_state(question="Impossible question"))

    assert result["retry_count"] == MAX_RETRIES
    assert result["final_answer"] is not None
    # Degradation message must mention retry failure
    assert "unable" in (result["final_answer"] or "").lower()


@pytest.mark.asyncio
async def test_citations_attached_on_every_answer() -> None:
    """researcher_node must populate citations regardless of review outcome."""
    mock_retriever = AsyncMock()
    mock_retriever.retrieve.return_value = _fake_retrieval_result(
        "Fact one from the manual.",
        "Fact two from the manual.",
    )

    mock_embed: AsyncMock = AsyncMock(return_value=[0.0] * 10)
    mock_llm = AsyncMock()
    mock_llm.ainvoke.side_effect = [
        MagicMock(content="Answer using facts [1][2]."),
        MagicMock(content='{"score": 0.93, "issues": []}'),
    ]

    with patch("agents.nodes.ChatAnthropic", return_value=mock_llm):
        graph = build_graph(
            anthropic_api_key="test-key",
            embed_fn=mock_embed,
            retriever=mock_retriever,
        )
        result = await graph.ainvoke(_base_state(question="Explain Ignition tags"))

    assert len(result["citations"]) == 2
    assert result["citations"][0]["index"] == 1
    assert result["citations"][1]["index"] == 2
    # Each citation must have a source
    for c in result["citations"]:
        assert c.get("source")
