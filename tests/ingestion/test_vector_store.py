"""Unit tests for ingestion/vector_store.py."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from ingestion.chunker import Chunk
from ingestion.embedder import EmbeddedChunk
from ingestion.vector_store import _point_id, _to_sparse_vector, push_to_qdrant


def _make_ec(text: str, idx: int, source_hash: str = "abc") -> EmbeddedChunk:
    chunk = Chunk(
        text=text,
        chunk_index=idx,
        page_hint=idx + 1,
        token_count=50,
        source_hash=source_hash,
    )
    return EmbeddedChunk(
        chunk=chunk, dense_vector=[0.1] * 1536, embedder_used="cohere-embed-v4"
    )


def _fake_qdrant() -> MagicMock:
    client = MagicMock()
    client.get_collections = AsyncMock(return_value=MagicMock(collections=[]))
    client.create_collection = AsyncMock()
    client.upsert = AsyncMock()
    return client


# ── Sparse vector


def test_sparse_vector_non_empty() -> None:
    indices, values = _to_sparse_vector("hello world")
    assert len(indices) > 0
    assert len(indices) == len(values)


def test_sparse_vector_empty_text() -> None:
    indices, values = _to_sparse_vector("")
    assert indices == []
    assert values == []


def test_sparse_vector_values_normalised() -> None:
    _, values = _to_sparse_vector("the quick brown fox")
    assert all(0.0 < v <= 1.0 for v in values)


def test_sparse_vector_deterministic() -> None:
    i1, v1 = _to_sparse_vector("deterministic text")
    i2, v2 = _to_sparse_vector("deterministic text")
    assert i1 == i2
    assert v1 == v2


# ── Point ID


def test_point_id_is_stable() -> None:
    assert _point_id("hash123", 0) == _point_id("hash123", 0)


def test_point_id_differs_by_index() -> None:
    assert _point_id("hash123", 0) != _point_id("hash123", 1)


def test_point_id_differs_by_hash() -> None:
    assert _point_id("hash_a", 0) != _point_id("hash_b", 0)


# ── push_to_qdrant


@pytest.mark.asyncio
async def test_push_empty_list_returns_zero() -> None:
    client = _fake_qdrant()
    result = await push_to_qdrant([], client, collection_name="test")
    assert result == 0
    client.upsert.assert_not_called()


@pytest.mark.asyncio
async def test_push_creates_collection_on_first_run() -> None:
    client = _fake_qdrant()
    ecs = [_make_ec("hello world text", 0)]
    await push_to_qdrant(ecs, client, collection_name="new_col")
    client.create_collection.assert_called_once()


@pytest.mark.asyncio
async def test_push_skips_create_if_collection_exists() -> None:
    client = _fake_qdrant()
    existing = MagicMock()
    existing.name = "existing_col"
    client.get_collections = AsyncMock(return_value=MagicMock(collections=[existing]))

    ecs = [_make_ec("text", 0)]
    await push_to_qdrant(ecs, client, collection_name="existing_col")
    client.create_collection.assert_not_called()


@pytest.mark.asyncio
async def test_push_returns_correct_count() -> None:
    client = _fake_qdrant()
    ecs = [_make_ec(f"chunk {i}", i) for i in range(5)]
    count = await push_to_qdrant(ecs, client, collection_name="test")
    assert count == 5


@pytest.mark.asyncio
async def test_push_payload_includes_required_fields() -> None:
    client = _fake_qdrant()
    ecs = [_make_ec("test chunk", 0, source_hash="deadbeef")]
    await push_to_qdrant(
        ecs, client, collection_name="col", tenant_id="tenant_a", source="my_doc.pdf"
    )

    upsert_call = client.upsert.call_args
    points = upsert_call.kwargs["points"]
    assert len(points) == 1

    payload = points[0].payload
    assert payload["tenant_id"] == "tenant_a"
    assert payload["source"] == "my_doc.pdf"
    assert payload["chunk_index"] == 0
    assert "created_at" in payload
    assert "text" in payload
