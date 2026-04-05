"""Unit tests for POST /api/query.

All agent graph, memory, and embed calls are mocked — no external services.

Coverage targets
----------------
- Happy path: returns answer + citations + metadata
- Coder route: code_snippet populated
- Retry loop: retry_count > 0 reflected in response
- Graceful degradation: retry_count == MAX_RETRIES, answer contains "unable"
- Embed fn factory: Voyage key present → _voyage_embed; absent → _bge_embed
- Graph init failure: 500 with detail
- Agent execution failure: 500 with detail
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from agents.state import MAX_RETRIES

# ── App factory (patch settings before import)

_BASE_ENV = {
    "ANTHROPIC_API_KEY": "sk-test",
    "APP_ENV": "development",
}


def _make_client(env: dict[str, str] | None = None) -> TestClient:
    """Create a TestClient with settings patched from env."""
    import api.routes.query as query_mod

    # Clear lru/functools caches so each test gets a fresh state.
    query_mod._make_embed_fn.cache_clear()
    query_mod._get_graph_memory.cache_clear()

    merged = {**_BASE_ENV, **(env or {})}
    with patch.dict(os.environ, merged, clear=False):
        import api.config as config_mod

        config_mod.get_settings.cache_clear()
        from api.main import create_app

        app = create_app()
        return TestClient(app, raise_server_exceptions=False)


def _fake_state(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "question": "What is the Gateway?",
        "session_id": "s1",
        "tenant_id": "default",
        "route": "researcher",
        "model_used": "claude-haiku-3-5",
        "context": [
            {
                "text": "The Gateway manages connections.",
                "score": 0.9,
                "source": "ch1.pdf",
                "chunk_id": "c1",
            }
        ],
        "citations": [
            {"index": 1, "source": "ch1.pdf", "chunk_id": "c1", "score": 0.9}
        ],
        "memory_facts": [],
        "code_snippet": None,
        "final_answer": "The Gateway manages device connections [1].",
        "errors": [],
        "faithfulness_score": 0.95,
        "retry_count": 0,
    }
    base.update(overrides)
    return base


# ── Helper: patch the entire /api/query request path


def _patch_query_deps(
    final_state: dict[str, Any],
    graph_init_raises: Exception | None = None,
    graph_exec_raises: Exception | None = None,
) -> tuple[Any, Any, Any, Any]:
    """Return context managers that mock embed_fn, graph, and memory."""
    mock_embed = AsyncMock(return_value=[0.0] * 1024)
    mock_graph = AsyncMock()
    if graph_exec_raises:
        mock_graph.ainvoke.side_effect = graph_exec_raises
    else:
        mock_graph.ainvoke.return_value = final_state

    mock_memory = AsyncMock()
    mock_memory.recall_context.return_value = []

    if graph_init_raises:
        mock_build = MagicMock(side_effect=graph_init_raises)
    else:
        mock_build = MagicMock(return_value=mock_graph)

    return mock_embed, mock_graph, mock_memory, mock_build


# ── Tests


def test_query_happy_path_researcher() -> None:
    """Normal researcher answer: returns 200 with answer, citations, metadata."""
    state = _fake_state()
    mock_embed, _, mock_memory, mock_build = _patch_query_deps(state)

    with (
        patch("api.routes.query._make_embed_fn", return_value=mock_embed),
        patch("api.routes.query._graph_from_settings", mock_build),
        patch("api.routes.query._get_graph_memory", return_value=mock_memory),
    ):
        client = _make_client()
        resp = client.post(
            "/api/query",
            json={
                "question": "What is the Gateway?",
                "session_id": "s1",
                "tenant_id": "default",
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"] == state["final_answer"]
    assert len(body["citations"]) == 1
    assert body["citations"][0]["source"] == "ch1.pdf"
    assert body["model_used"] == "claude-haiku-3-5"
    assert body["retry_count"] == 0
    assert body["faithfulness_score"] == pytest.approx(0.95)
    assert body["latency_ms"] >= 0
    assert body["code_snippet"] is None


def test_query_coder_route_returns_code_snippet() -> None:
    """Coder route: code_snippet is present in the response."""
    state = _fake_state(
        route="coder",
        model_used="claude-sonnet-4",
        code_snippet="value = system.tag.read('[default]MyTag')",
        final_answer="value = system.tag.read('[default]MyTag')",
    )
    _, _, mock_memory, mock_build = _patch_query_deps(state)
    mock_embed = AsyncMock(return_value=[0.0] * 1024)

    with (
        patch("api.routes.query._make_embed_fn", return_value=mock_embed),
        patch("api.routes.query._graph_from_settings", mock_build),
        patch("api.routes.query._get_graph_memory", return_value=mock_memory),
    ):
        client = _make_client()
        resp = client.post(
            "/api/query",
            json={"question": "Write code to read a tag", "session_id": "s1"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code_snippet"] is not None
    assert "system.tag.read" in body["code_snippet"]


def test_query_retry_count_reflected_in_response() -> None:
    """retry_count > 0 is returned in the response."""
    state = _fake_state(retry_count=1, faithfulness_score=0.92)
    _, _, mock_memory, mock_build = _patch_query_deps(state)
    mock_embed = AsyncMock(return_value=[0.0] * 1024)

    with (
        patch("api.routes.query._make_embed_fn", return_value=mock_embed),
        patch("api.routes.query._graph_from_settings", mock_build),
        patch("api.routes.query._get_graph_memory", return_value=mock_memory),
    ):
        client = _make_client()
        resp = client.post("/api/query", json={"question": "What is a Tag?"})

    assert resp.status_code == 200
    assert resp.json()["retry_count"] == 1


def test_query_graceful_degradation_message() -> None:
    """When MAX_RETRIES reached, degradation answer is returned (not a 500)."""
    degrade_answer = (
        f"I was unable to generate a sufficiently faithful answer after "
        f"{MAX_RETRIES} attempts."
    )
    state = _fake_state(
        retry_count=MAX_RETRIES,
        faithfulness_score=0.4,
        final_answer=degrade_answer,
    )
    _, _, mock_memory, mock_build = _patch_query_deps(state)
    mock_embed = AsyncMock(return_value=[0.0] * 1024)

    with (
        patch("api.routes.query._make_embed_fn", return_value=mock_embed),
        patch("api.routes.query._graph_from_settings", mock_build),
        patch("api.routes.query._get_graph_memory", return_value=mock_memory),
    ):
        client = _make_client()
        resp = client.post("/api/query", json={"question": "Impossible question"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["retry_count"] == MAX_RETRIES
    assert "unable" in body["answer"].lower()


def test_query_graph_init_failure_returns_500() -> None:
    """A graph init exception surfaces as HTTP 500."""
    _, _, mock_memory, mock_build = _patch_query_deps(
        {},
        graph_init_raises=RuntimeError("bad key"),
    )
    mock_embed = AsyncMock(return_value=[0.0] * 1024)

    with (
        patch("api.routes.query._make_embed_fn", return_value=mock_embed),
        patch("api.routes.query._graph_from_settings", mock_build),
        patch("api.routes.query._get_graph_memory", return_value=mock_memory),
    ):
        client = _make_client()
        resp = client.post("/api/query", json={"question": "Test"})

    assert resp.status_code == 500
    assert "Agent init failed" in resp.json()["detail"]


def test_query_graph_execution_failure_returns_500() -> None:
    """An exception during graph.ainvoke surfaces as HTTP 500."""
    state = _fake_state()
    _, _, mock_memory, mock_build = _patch_query_deps(
        state,
        graph_exec_raises=RuntimeError("graph crash"),
    )
    mock_embed = AsyncMock(return_value=[0.0] * 1024)

    with (
        patch("api.routes.query._make_embed_fn", return_value=mock_embed),
        patch("api.routes.query._graph_from_settings", mock_build),
        patch("api.routes.query._get_graph_memory", return_value=mock_memory),
    ):
        client = _make_client()
        resp = client.post("/api/query", json={"question": "Test"})

    assert resp.status_code == 500
    assert "Agent execution failed" in resp.json()["detail"]


def test_query_memory_failure_does_not_break_response() -> None:
    """Graphiti recall failure is swallowed; endpoint still returns 200."""
    state = _fake_state()
    mock_embed = AsyncMock(return_value=[0.0] * 1024)
    mock_graph = AsyncMock()
    mock_graph.ainvoke.return_value = state
    mock_build = MagicMock(return_value=mock_graph)

    mock_memory = AsyncMock()
    mock_memory.recall_context.side_effect = RuntimeError("graphiti down")

    with (
        patch("api.routes.query._make_embed_fn", return_value=mock_embed),
        patch("api.routes.query._graph_from_settings", mock_build),
        patch("api.routes.query._get_graph_memory", return_value=mock_memory),
    ):
        client = _make_client()
        resp = client.post("/api/query", json={"question": "What is a Gateway?"})

    assert resp.status_code == 200
    assert resp.json()["answer"] == state["final_answer"]


def test_query_request_validation_empty_question() -> None:
    """Empty question is rejected with 422 before reaching the agent."""
    client = _make_client()
    resp = client.post("/api/query", json={"question": ""})
    assert resp.status_code == 422


def test_query_missing_question_field() -> None:
    """Missing question field returns 422."""
    client = _make_client()
    resp = client.post("/api/query", json={})
    assert resp.status_code == 422
