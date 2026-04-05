"""Unit tests for GraphitiMemory — no Neo4j or Graphiti required.

All Graphiti imports are mocked so the tests run in a vanilla CI environment.
Coverage targets:
- __init__ with graphiti available → self._available = True
- __init__ with graphiti missing → graceful no-op
- build_indices: delegates to _client and swallows exceptions
- store_turn: correct episode body constructed; swallows exceptions
- recall_context: returns fact strings; swallows exceptions
- close: delegates to _client; swallows exceptions
- all no-ops when _available=False
"""

from __future__ import annotations

import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── helpers


def _make_memory(
    neo4j_uri: str = "bolt://localhost:7687",
    neo4j_user: str = "neo4j",
    neo4j_password: str = "pw",
    anthropic_api_key: str = "sk-test",
) -> Any:
    """Import and instantiate GraphitiMemory with graphiti mocked out."""
    from agents.memory import GraphitiMemory

    return GraphitiMemory(
        neo4j_uri=neo4j_uri,
        neo4j_user=neo4j_user,
        neo4j_password=neo4j_password,
        anthropic_api_key=anthropic_api_key,
    )


# ── init


def test_init_available_when_graphiti_importable() -> None:
    """When graphiti_core is importable, _available is True and _client is set."""
    mock_graphiti_instance = MagicMock()
    mock_graphiti_cls = MagicMock(return_value=mock_graphiti_instance)
    mock_llm_client = MagicMock()
    mock_anthropic_client = MagicMock()

    mock_graphiti_core = MagicMock()
    mock_graphiti_core.Graphiti = mock_graphiti_cls
    mock_graphiti_core.llm_client = MagicMock()
    mock_graphiti_core.llm_client.anthropic_client = MagicMock()
    mock_graphiti_core.llm_client.anthropic_client.AnthropicClient = MagicMock(
        return_value=mock_llm_client
    )
    mock_graphiti_core.llm_client.anthropic_client.LLMConfig = MagicMock()

    with (
        patch.dict(
            "sys.modules",
            {
                "graphiti_core": mock_graphiti_core,
                "graphiti_core.llm_client": mock_graphiti_core.llm_client,
                "graphiti_core.llm_client.anthropic_client": mock_graphiti_core.llm_client.anthropic_client,
                "graphiti_core.nodes": MagicMock(),
                "anthropic": MagicMock(
                    AsyncAnthropic=MagicMock(return_value=mock_anthropic_client)
                ),
            },
        ),
    ):
        # Re-import to pick up mocked modules
        if "agents.memory" in sys.modules:
            del sys.modules["agents.memory"]
        from agents.memory import GraphitiMemory as GM

        mem = GM(
            neo4j_uri="bolt://localhost:7687",
            neo4j_user="neo4j",
            neo4j_password="pw",
            anthropic_api_key="sk-test",
        )

    assert mem._available is True
    assert mem._client is not None


def test_init_graceful_on_import_error() -> None:
    """If graphiti_core is not installed, _available=False and methods no-op."""
    with patch("builtins.__import__", side_effect=ImportError("no graphiti")):
        # Patch only within GraphitiMemory.__init__ scope
        pass

    # Simpler: reload agents.memory with graphiti_core absent from sys.modules
    saved = sys.modules.pop("graphiti_core", None)
    saved_nodes = sys.modules.pop("graphiti_core.nodes", None)
    saved_agents_memory = sys.modules.pop("agents.memory", None)

    try:
        with patch.dict("sys.modules", {"graphiti_core": None}):  # type: ignore[dict-item]
            if "agents.memory" in sys.modules:
                del sys.modules["agents.memory"]
            from agents.memory import GraphitiMemory as GM2

            mem = GM2(
                neo4j_uri="bolt://localhost:7687",
                neo4j_user="neo4j",
                neo4j_password="pw",
                anthropic_api_key="sk-test",
            )
        assert mem._available is False
        assert mem._client is None
    finally:
        if saved is not None:
            sys.modules["graphiti_core"] = saved
        if saved_nodes is not None:
            sys.modules["graphiti_core.nodes"] = saved_nodes
        if saved_agents_memory is not None:
            sys.modules["agents.memory"] = saved_agents_memory


# ── build_indices


@pytest.mark.asyncio
async def test_build_indices_no_op_when_unavailable() -> None:
    """build_indices is a no-op when _available is False."""
    from agents.memory import GraphitiMemory

    mem = GraphitiMemory.__new__(GraphitiMemory)
    mem._available = False
    mem._client = None
    await mem.build_indices()  # must not raise


@pytest.mark.asyncio
async def test_build_indices_delegates_to_client() -> None:
    """build_indices calls _client.build_indices_and_constraints."""
    from agents.memory import GraphitiMemory

    mock_client = AsyncMock()
    mem = GraphitiMemory.__new__(GraphitiMemory)
    mem._available = True
    mem._client = mock_client

    await mem.build_indices()
    mock_client.build_indices_and_constraints.assert_awaited_once()


@pytest.mark.asyncio
async def test_build_indices_swallows_exception() -> None:
    """build_indices does not propagate exceptions from _client."""
    from agents.memory import GraphitiMemory

    mock_client = AsyncMock()
    mock_client.build_indices_and_constraints.side_effect = RuntimeError("neo4j down")
    mem = GraphitiMemory.__new__(GraphitiMemory)
    mem._available = True
    mem._client = mock_client

    await mem.build_indices()  # must not raise


# ── store_turn


@pytest.mark.asyncio
async def test_store_turn_no_op_when_unavailable() -> None:
    from agents.memory import GraphitiMemory

    mem = GraphitiMemory.__new__(GraphitiMemory)
    mem._available = False
    mem._client = None
    await mem.store_turn("s1", "default", "q", "a", [])  # must not raise


@pytest.mark.asyncio
async def test_store_turn_calls_add_episode() -> None:
    """store_turn constructs an episode with question+answer in the body."""
    from agents.memory import GraphitiMemory

    mock_client = AsyncMock()
    mem = GraphitiMemory.__new__(GraphitiMemory)
    mem._available = True
    mem._client = mock_client

    mock_episode_type = MagicMock()
    mock_episode_type.text = "text"

    with patch.dict(
        "sys.modules",
        {"graphiti_core.nodes": MagicMock(EpisodeType=mock_episode_type)},
    ):
        await mem.store_turn(
            session_id="sess-1",
            tenant_id="t1",
            question="What is Ignition?",
            answer="It is a SCADA platform.",
            citations=[{"source": "ch1.pdf"}, {"source": "ch2.pdf"}],
        )

    mock_client.add_episode.assert_awaited_once()
    call_kwargs = mock_client.add_episode.call_args.kwargs
    assert "What is Ignition?" in call_kwargs["episode_body"]
    assert "It is a SCADA platform." in call_kwargs["episode_body"]
    assert "ch1.pdf" in call_kwargs["episode_body"]
    assert call_kwargs["group_id"] == "tenant:t1"


@pytest.mark.asyncio
async def test_store_turn_swallows_exception() -> None:
    from agents.memory import GraphitiMemory

    mock_client = AsyncMock()
    mock_client.add_episode.side_effect = RuntimeError("graphiti error")
    mem = GraphitiMemory.__new__(GraphitiMemory)
    mem._available = True
    mem._client = mock_client

    with patch.dict(
        "sys.modules",
        {"graphiti_core.nodes": MagicMock(EpisodeType=MagicMock(text="text"))},
    ):
        await mem.store_turn("s", "t", "q", "a", [])  # must not raise


# ── recall_context


@pytest.mark.asyncio
async def test_recall_context_returns_empty_when_unavailable() -> None:
    from agents.memory import GraphitiMemory

    mem = GraphitiMemory.__new__(GraphitiMemory)
    mem._available = False
    mem._client = None
    result = await mem.recall_context("default", "question")
    assert result == []


@pytest.mark.asyncio
async def test_recall_context_returns_fact_strings() -> None:
    from agents.memory import GraphitiMemory

    fact1, fact2 = MagicMock(fact="Fact A"), MagicMock(fact="Fact B")
    mock_client = AsyncMock()
    mock_client.search.return_value = [fact1, fact2]
    mem = GraphitiMemory.__new__(GraphitiMemory)
    mem._available = True
    mem._client = mock_client

    results = await mem.recall_context("t1", "some question", num_results=3)

    assert results == ["Fact A", "Fact B"]
    mock_client.search.assert_awaited_once_with(
        query="some question",
        group_ids=["tenant:t1"],
        num_results=3,
    )


@pytest.mark.asyncio
async def test_recall_context_swallows_exception() -> None:
    from agents.memory import GraphitiMemory

    mock_client = AsyncMock()
    mock_client.search.side_effect = RuntimeError("timeout")
    mem = GraphitiMemory.__new__(GraphitiMemory)
    mem._available = True
    mem._client = mock_client

    result = await mem.recall_context("t", "q")
    assert result == []


# ── close


@pytest.mark.asyncio
async def test_close_no_op_when_client_none() -> None:
    from agents.memory import GraphitiMemory

    mem = GraphitiMemory.__new__(GraphitiMemory)
    mem._available = False
    mem._client = None
    await mem.close()  # must not raise


@pytest.mark.asyncio
async def test_close_calls_client_close() -> None:
    from agents.memory import GraphitiMemory

    mock_client = AsyncMock()
    mem = GraphitiMemory.__new__(GraphitiMemory)
    mem._available = True
    mem._client = mock_client

    await mem.close()
    mock_client.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_close_swallows_exception() -> None:
    from agents.memory import GraphitiMemory

    mock_client = AsyncMock()
    mock_client.close.side_effect = RuntimeError("disconnect error")
    mem = GraphitiMemory.__new__(GraphitiMemory)
    mem._available = True
    mem._client = mock_client

    await mem.close()  # must not raise
