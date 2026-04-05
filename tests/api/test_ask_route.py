"""Tests for POST /v1/ask — SSE streaming endpoint.

All external dependencies (agent graph, Graphiti memory, ResponseCache) are
mocked so these tests run entirely in-process without any live services.

Key fixture pattern
-------------------
All `with patch(...)` blocks must stay alive for the entire test, not just
during `create_app()`.  Use `yield` (not `return`) from generator fixtures so
the patch context persists through the request/response cycle.

The `_clear_ask_cache` autouse fixture clears the `functools.cache`
singletons in `api.routes.ask` so each test starts from a clean state.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient


# ── Helpers


def _parse_sse(raw: bytes) -> list[dict[str, Any]]:
    """Parse a raw SSE body into a list of decoded event dicts."""
    events = []
    for line in raw.decode().splitlines():
        line = line.strip()
        if line.startswith("data:"):
            payload = line[len("data:") :].strip()
            try:
                events.append(json.loads(payload))
            except json.JSONDecodeError:
                pass
    return events


async def _fake_astream(initial_state: dict) -> AsyncIterator[dict[str, Any]]:
    """Fake graph.astream that yields one chunk per node."""
    yield {
        "classifier": {"route": "researcher", "model_used": "claude-haiku-4-5-20251001"}
    }
    yield {
        "researcher": {
            "context": [
                {"text": "ctx", "score": 0.9, "source": "doc.pdf", "chunk_id": "abc"}
            ],
            "citations": [
                {"index": 1, "source": "doc.pdf", "chunk_id": "abc", "score": 0.9}
            ],
            "final_answer": "42 is the answer.",
        }
    }
    yield {
        "reviewer": {
            "faithfulness_score": 0.92,
            "retry_count": 0,
            "final_answer": "42 is the answer.",
            "model_used": "claude-haiku-4-5-20251001",
        }
    }


# ── Autouse: clear @cache singletons between tests


@pytest.fixture(autouse=True)
def _clear_ask_cache() -> None:  # sync — no async needed
    """Clear functools.cache singletons so each test starts from a clean state."""
    import api.routes.ask as ask_mod  # noqa: PLC0415

    ask_mod._get_graph.cache_clear()  # type: ignore[attr-defined]
    ask_mod._get_cache.cache_clear()  # type: ignore[attr-defined]
    ask_mod._get_memory.cache_clear()  # type: ignore[attr-defined]
    ask_mod._make_embed_fn.cache_clear()  # type: ignore[attr-defined]


# ── Fixtures


@pytest.fixture(autouse=True)
def _patch_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")


@pytest.fixture()
def mock_graph() -> MagicMock:
    graph = MagicMock()
    graph.astream = _fake_astream
    return graph


@pytest.fixture()
def mock_memory() -> AsyncMock:
    mem = AsyncMock()
    mem.build_indices = AsyncMock()
    mem.recall_context = AsyncMock(return_value=["Prior fact 1"])
    mem.store_turn = AsyncMock()
    return mem


@pytest.fixture()
def mock_cache_miss() -> AsyncMock:
    cache = AsyncMock()
    cache.get = AsyncMock(return_value=None)
    cache.set = AsyncMock()
    cache._emb_get = AsyncMock(return_value=None)  # noqa: SLF001
    return cache


@pytest.fixture()
def mock_embed_fn() -> Any:
    async def _embed(text: str) -> list[float]:
        return [0.1] * 1024

    return _embed


@pytest.fixture()
def app(
    mock_graph: MagicMock,
    mock_memory: AsyncMock,
    mock_cache_miss: AsyncMock,
    mock_embed_fn: Any,
) -> Any:
    # yield (not return) so the patch context stays alive for the full test.
    with (
        patch("api.routes.ask._get_graph", return_value=mock_graph),
        patch("api.routes.ask._get_memory", return_value=mock_memory),
        patch("api.routes.ask._get_cache", return_value=mock_cache_miss),
        patch("api.routes.ask._make_embed_fn", return_value=mock_embed_fn),
        patch("worker.broker.broker.startup", new_callable=AsyncMock),
        patch("worker.broker.broker.shutdown", new_callable=AsyncMock),
    ):
        from api.main import create_app  # noqa: PLC0415

        yield create_app()


# ── Tests


@pytest.mark.asyncio
async def test_ask_emits_all_event_types(app: Any) -> None:
    """Happy path: cache miss → full SSE stream with all event types."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/v1/ask",
            json={"question": "What is the answer to life?"},
        )

    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]

    events = _parse_sse(response.content)
    types = [e["type"] for e in events]

    assert "tool_start" in types
    assert "tool_result" in types
    assert "delta" in types
    assert "citation" in types
    assert "final" in types


@pytest.mark.asyncio
async def test_ask_final_event_has_required_fields(app: Any) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/ask", json={"question": "Tell me something"})

    events = _parse_sse(response.content)
    final = next(e for e in events if e["type"] == "final")

    assert "answer" in final
    assert "model_used" in final
    assert "retry_count" in final
    assert "latency_ms" in final
    assert final["latency_ms"] > 0


@pytest.mark.asyncio
async def test_ask_delta_chunks_spell_out_answer(app: Any) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/ask", json={"question": "What?"})

    events = _parse_sse(response.content)
    deltas = [e for e in events if e["type"] == "delta"]
    combined = "".join(d["content"] for d in deltas).strip()

    final = next(e for e in events if e["type"] == "final")
    assert combined == final["answer"]


@pytest.mark.asyncio
async def test_ask_sse_headers(app: Any) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/ask", json={"question": "Ping"})

    assert response.headers.get("cache-control") == "no-cache"
    assert response.headers.get("x-accel-buffering") == "no"


@pytest.mark.asyncio
async def test_ask_l1_cache_hit(
    mock_graph: MagicMock,
    mock_memory: AsyncMock,
    mock_embed_fn: Any,
) -> None:
    """L1 cache hit: stream starts with cache_hit event, skips node events."""
    cached_response = {
        "answer": "Cached answer here.",
        "citations": [
            {"index": 1, "source": "cache.pdf", "chunk_id": None, "score": 0.99}
        ],
        "model_used": "claude-haiku-4-5-20251001",
        "retry_count": 0,
        "faithfulness_score": 0.95,
    }
    mock_cache_hit = AsyncMock()
    mock_cache_hit.get = AsyncMock(return_value=("L1", cached_response, None))
    mock_cache_hit.set = AsyncMock()
    mock_cache_hit._emb_get = AsyncMock(return_value=None)  # noqa: SLF001

    with (
        patch("api.routes.ask._get_graph", return_value=mock_graph),
        patch("api.routes.ask._get_memory", return_value=mock_memory),
        patch("api.routes.ask._get_cache", return_value=mock_cache_hit),
        patch("api.routes.ask._make_embed_fn", return_value=mock_embed_fn),
        patch("worker.broker.broker.startup", new_callable=AsyncMock),
        patch("worker.broker.broker.shutdown", new_callable=AsyncMock),
    ):
        from api.main import create_app  # noqa: PLC0415

        app = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/v1/ask", json={"question": "Cached question"}
            )

    events = _parse_sse(response.content)
    types = [e["type"] for e in events]

    assert "cache_hit" in types
    assert "tool_start" not in types  # no graph execution

    cache_evt = next(e for e in events if e["type"] == "cache_hit")
    assert cache_evt["layer"] == "L1"

    final = next(e for e in events if e["type"] == "final")
    assert final["answer"] == "Cached answer here."


@pytest.mark.asyncio
async def test_ask_l2_cache_hit(
    mock_graph: MagicMock,
    mock_memory: AsyncMock,
    mock_embed_fn: Any,
) -> None:
    """L2 semantic cache hit includes similarity score."""
    cached_response = {
        "answer": "Semantically cached answer.",
        "citations": [],
        "model_used": "claude-haiku-4-5-20251001",
        "retry_count": 0,
        "faithfulness_score": 0.88,
    }
    mock_cache_hit = AsyncMock()
    mock_cache_hit.get = AsyncMock(return_value=("L2", cached_response, 0.93))
    mock_cache_hit.set = AsyncMock()
    mock_cache_hit._emb_get = AsyncMock(return_value=None)  # noqa: SLF001

    with (
        patch("api.routes.ask._get_graph", return_value=mock_graph),
        patch("api.routes.ask._get_memory", return_value=mock_memory),
        patch("api.routes.ask._get_cache", return_value=mock_cache_hit),
        patch("api.routes.ask._make_embed_fn", return_value=mock_embed_fn),
        patch("worker.broker.broker.startup", new_callable=AsyncMock),
        patch("worker.broker.broker.shutdown", new_callable=AsyncMock),
    ):
        from api.main import create_app  # noqa: PLC0415

        app = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/v1/ask", json={"question": "Similar question"}
            )

    events = _parse_sse(response.content)
    cache_evt = next(e for e in events if e["type"] == "cache_hit")
    assert cache_evt["layer"] == "L2"
    assert abs(cache_evt["similarity"] - 0.93) < 0.001


@pytest.mark.asyncio
async def test_ask_rate_limit_exceeded(app: Any) -> None:
    """Rate limit middleware returns 429 before the SSE handler fires."""
    with patch(
        "api.middleware.rate_limit.RateLimitMiddleware.dispatch",
        new_callable=AsyncMock,
    ) as mock_dispatch:
        from fastapi import Response  # noqa: PLC0415

        mock_dispatch.return_value = Response(
            content='{"detail":"Rate limit exceeded"}',
            status_code=429,
            headers={"Retry-After": "3600"},
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/v1/ask",
                json={"question": "Too many tokens"},
                headers={"X-API-Key": "free-key"},
            )

    assert response.status_code == 429
    assert "Retry-After" in response.headers


@pytest.mark.asyncio
async def test_ask_graph_error_emits_error_event(
    mock_memory: AsyncMock,
    mock_cache_miss: AsyncMock,
    mock_embed_fn: Any,
) -> None:
    """If the graph raises, the stream emits an error event."""

    async def _boom(initial_state: dict) -> AsyncIterator[dict]:  # type: ignore[misc]
        # Yield an empty chunk first (skipped by _TRACKED_NODES check),
        # then raise so the except block emits an error SSE event.
        yield {}
        raise RuntimeError("Graph exploded")

    broken_graph = MagicMock()
    broken_graph.astream = _boom

    with (
        patch("api.routes.ask._get_graph", return_value=broken_graph),
        patch("api.routes.ask._get_memory", return_value=mock_memory),
        patch("api.routes.ask._get_cache", return_value=mock_cache_miss),
        patch("api.routes.ask._make_embed_fn", return_value=mock_embed_fn),
        patch("worker.broker.broker.startup", new_callable=AsyncMock),
        patch("worker.broker.broker.shutdown", new_callable=AsyncMock),
    ):
        from api.main import create_app  # noqa: PLC0415

        app = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post("/v1/ask", json={"question": "What breaks?"})

    events = _parse_sse(response.content)
    assert any(e["type"] == "error" for e in events)


@pytest.mark.asyncio
async def test_ask_validation_rejects_empty_question(app: Any) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/ask", json={"question": ""})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_ask_validation_rejects_missing_question(app: Any) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/ask", json={})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_ask_memory_failure_does_not_break_stream(
    mock_graph: MagicMock,
    mock_cache_miss: AsyncMock,
    mock_embed_fn: Any,
) -> None:
    """Graphiti being down must not prevent the SSE stream from completing."""
    broken_memory = AsyncMock()
    broken_memory.build_indices = AsyncMock(side_effect=ConnectionError("Neo4j down"))
    broken_memory.recall_context = AsyncMock(side_effect=ConnectionError("Neo4j down"))
    broken_memory.store_turn = AsyncMock(side_effect=ConnectionError("Neo4j down"))

    with (
        patch("api.routes.ask._get_graph", return_value=mock_graph),
        patch("api.routes.ask._get_memory", return_value=broken_memory),
        patch("api.routes.ask._get_cache", return_value=mock_cache_miss),
        patch("api.routes.ask._make_embed_fn", return_value=mock_embed_fn),
        patch("worker.broker.broker.startup", new_callable=AsyncMock),
        patch("worker.broker.broker.shutdown", new_callable=AsyncMock),
    ):
        from api.main import create_app  # noqa: PLC0415

        app = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/v1/ask", json={"question": "Will this work?"}
            )

    assert response.status_code == 200
    events = _parse_sse(response.content)
    assert any(e["type"] == "final" for e in events)
