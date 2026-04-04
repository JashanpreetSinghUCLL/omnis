"""Unit tests for ingestion/embedder.py.

All Cohere / fastembed calls and Redis I/O are mocked.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ingestion.chunker import Chunk
from ingestion.embedder import EmbeddedChunk, _chunk_cache_key, embed_chunks


def _make_chunk(text: str, idx: int = 0) -> Chunk:
    return Chunk(
        text=text, chunk_index=idx, page_hint=None, token_count=10, source_hash="hash0"
    )


def _fake_redis(cached: dict[str, list[float]] | None = None) -> MagicMock:
    """Return an async-compatible fake Redis client."""
    cached = cached or {}
    redis = MagicMock()
    redis.get = AsyncMock(side_effect=lambda key: cached.get(key))
    redis.set = AsyncMock()
    return redis


# ── Cache key


def test_cache_key_is_deterministic() -> None:
    k1 = _chunk_cache_key("cohere-embed-v4", "hello")
    k2 = _chunk_cache_key("cohere-embed-v4", "hello")
    assert k1 == k2


def test_cache_key_differs_by_model() -> None:
    k1 = _chunk_cache_key("cohere-embed-v4", "hello")
    k2 = _chunk_cache_key("bge-m3", "hello")
    assert k1 != k2


def test_cache_key_differs_by_text() -> None:
    k1 = _chunk_cache_key("cohere-embed-v4", "hello")
    k2 = _chunk_cache_key("cohere-embed-v4", "world")
    assert k1 != k2


# ── Cohere path


@pytest.mark.asyncio
async def test_embed_voyage_returns_embedded_chunks() -> None:
    chunks = [_make_chunk("text A", 0), _make_chunk("text B", 1)]
    fake_vector = [0.1, 0.2, 0.3]

    redis = _fake_redis()

    with patch(
        "ingestion.embedder._embed_voyage",
        new=AsyncMock(return_value=[fake_vector, fake_vector]),
    ):
        results = await embed_chunks(chunks, redis=redis, voyage_api_key="test-key")

    assert len(results) == 2
    assert all(isinstance(r, EmbeddedChunk) for r in results)
    assert results[0].embedder_used == "voyage-4-large"
    assert results[0].dense_vector == fake_vector


@pytest.mark.asyncio
async def test_embed_uses_cache_when_available() -> None:
    chunk = _make_chunk("cached text", 0)
    cached_vector = [0.9, 0.8, 0.7]

    import json

    redis = _fake_redis()
    redis.get = AsyncMock(return_value=json.dumps(cached_vector))

    with patch("ingestion.embedder._embed_voyage", new=AsyncMock()) as mock_voyage:
        results = await embed_chunks([chunk], redis=redis, voyage_api_key="test-key")
        mock_voyage.assert_not_called()  # API must NOT be hit

    assert results[0].dense_vector == cached_vector


# ── BGE-M3 fallback path


@pytest.mark.asyncio
async def test_embed_falls_back_to_bge_when_no_voyage_key() -> None:
    chunks = [_make_chunk("local text", 0)]
    fake_vector = [0.5] * 1024

    redis = _fake_redis()

    with patch(
        "ingestion.embedder._embed_bge", new=AsyncMock(return_value=[fake_vector])
    ):
        results = await embed_chunks(chunks, redis=redis, voyage_api_key=None)

    assert results[0].embedder_used == "bge-large-en-v1.5"
    assert results[0].dense_vector == fake_vector


# ── Batching


@pytest.mark.asyncio
async def test_embed_batches_correctly() -> None:
    """120 chunks → 3 batches of 50 (50 + 50 + 20). Inter-batch delay is mocked out."""
    n = 120
    chunks = [_make_chunk(f"text {i}", i) for i in range(n)]
    fake_vector = [0.1] * 2048

    redis = _fake_redis()
    call_sizes: list[int] = []

    def fake_voyage(texts: list[str], api_key: str) -> list[list[float]]:
        call_sizes.append(len(texts))
        return [fake_vector] * len(texts)

    with (
        patch(
            "ingestion.embedder._embed_voyage", new=AsyncMock(side_effect=fake_voyage)
        ),
        patch(
            "ingestion.embedder.asyncio.sleep", new=AsyncMock()
        ),  # skip rate-limit delay
    ):
        results = await embed_chunks(chunks, redis=redis, voyage_api_key="key")

    assert len(results) == n
    assert max(call_sizes) <= 50
    assert sum(call_sizes) == n
