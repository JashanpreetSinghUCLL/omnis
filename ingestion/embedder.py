"""Chunk embedder.

Primary:  Voyage AI (voyage-4-large, requires VOYAGE_API_KEY).
Fallback: BAAI/bge-m3 via fastembed (local, no API key).

Shared embedding space advantage
---------------------------------
All Voyage 4 variants (nano, lite, standard, large) share the same vector
space.  This means:
  - Ingest documents with voyage-4-large (highest quality)
  - Embed queries at runtime with voyage-3.5-lite (6x cheaper)
  - No re-indexing ever needed when switching query models

Batching: 128 chunks per call (Voyage recommended max).
Cache key: embed:{model_tag}:{sha256(chunk.text)}, TTL 30 days.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Any

from ingestion.chunker import Chunk
from ingestion.embed_config import LOCAL_EMBED_MODEL

logger = logging.getLogger(__name__)

_BATCH_SIZE = 50        # conservative — free trial is rate-limited (~3 RPM)
_CACHE_TTL_S = 30 * 24 * 3_600  # 30 days
_INTER_BATCH_DELAY_S = 22.0     # 3 RPM → 1 req per 20s; +2s margin

# Model used for document ingestion (highest retrieval quality)
_VOYAGE_DOC_MODEL = "voyage-4-large"


@dataclass
class EmbeddedChunk:
    chunk: Chunk
    dense_vector: list[float]
    embedder_used: str  # "voyage-4-large" | "bge-m3"


# ── Cache helpers ─────────────────────────────────────────────────────────────


def _chunk_cache_key(model_tag: str, text: str) -> str:
    text_hash = hashlib.sha256(text.encode()).hexdigest()
    return f"embed:{model_tag}:{text_hash}"


async def _cache_get(redis: Any, key: str) -> list[float] | None:
    raw = await redis.get(key)
    if raw is None:
        return None
    return json.loads(raw)


async def _cache_set(redis: Any, key: str, vector: list[float]) -> None:
    await redis.set(key, json.dumps(vector), ex=_CACHE_TTL_S)


# ── Voyage AI ─────────────────────────────────────────────────────────────────


async def _embed_voyage(texts: list[str], api_key: str) -> list[list[float]]:
    """Call Voyage embed API with exponential backoff on rate-limit (429)."""
    import voyageai  # type: ignore[import-untyped]
    from tenacity import (  # type: ignore[import-untyped]
        retry,
        retry_if_exception,
        stop_after_attempt,
        wait_exponential,
    )

    client = voyageai.AsyncClient(api_key=api_key)

    def _is_rate_limit(exc: BaseException) -> bool:
        msg = str(exc).lower()
        return "429" in msg or "rate limit" in msg or "too many requests" in msg

    @retry(
        retry=retry_if_exception(_is_rate_limit),
        wait=wait_exponential(multiplier=1, min=25, max=120),
        stop=stop_after_attempt(5),
        reraise=True,
    )
    async def _call() -> list[list[float]]:
        result = await client.embed(texts, model=_VOYAGE_DOC_MODEL, input_type="document")
        return result.embeddings

    return await _call()


# ── BGE-M3 via fastembed (sync, run in executor) ──────────────────────────────

_bge_model: "TextEmbedding | None" = None  # module-level singleton


def _get_bge_model() -> "TextEmbedding":
    global _bge_model
    if _bge_model is None:
        from fastembed import TextEmbedding  # type: ignore[import-untyped]
        _bge_model = TextEmbedding(LOCAL_EMBED_MODEL)
    return _bge_model


def _embed_bge_sync(texts: list[str]) -> list[list[float]]:
    model = _get_bge_model()
    return [v.tolist() for v in model.embed(texts)]


async def _embed_bge(texts: list[str]) -> list[list[float]]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _embed_bge_sync, texts)


# ── Batched embedding with cache ──────────────────────────────────────────────


async def embed_chunks(
    chunks: list[Chunk],
    redis: Any,
    voyage_api_key: str | None = None,
) -> list[EmbeddedChunk]:
    """Embed *chunks*, returning one :class:`EmbeddedChunk` per input chunk.

    Uses Voyage voyage-4-large when *voyage_api_key* is provided; falls back
    to local BAAI/bge-m3 via fastembed otherwise.

    Hits the Redis cache first; only sends uncached chunks to the API.
    """
    model_tag = _VOYAGE_DOC_MODEL if voyage_api_key else LOCAL_EMBED_MODEL

    # Phase 1: resolve cache
    results: list[list[float] | None] = [None] * len(chunks)
    uncached_indices: list[int] = []

    for i, chunk in enumerate(chunks):
        key = _chunk_cache_key(model_tag, chunk.text)
        vector = await _cache_get(redis, key)
        if vector is not None:
            results[i] = vector
        else:
            uncached_indices.append(i)

    logger.info(
        "Embedding: %d cached, %d to embed (model=%s)",
        len(chunks) - len(uncached_indices),
        len(uncached_indices),
        model_tag,
    )

    # Phase 2: batch-embed uncached chunks
    for batch_start in range(0, len(uncached_indices), _BATCH_SIZE):
        batch_indices = uncached_indices[batch_start : batch_start + _BATCH_SIZE]
        batch_texts = [chunks[i].text for i in batch_indices]

        if voyage_api_key:
            vectors = await _embed_voyage(batch_texts, voyage_api_key)
        else:
            vectors = await _embed_bge(batch_texts)

        for i, vector in zip(batch_indices, vectors):
            results[i] = vector
            key = _chunk_cache_key(model_tag, chunks[i].text)
            await _cache_set(redis, key, vector)

        logger.debug("Embedded batch of %d chunks", len(batch_indices))

        # Rate-limit guard: pause between Voyage batches on free tier.
        # Skipped after the last batch and when using the local BGE-M3 fallback.
        is_last_batch = batch_start + _BATCH_SIZE >= len(uncached_indices)
        if voyage_api_key and not is_last_batch:
            logger.debug("Waiting %.0fs for Voyage rate limit…", _INTER_BATCH_DELAY_S)
            await asyncio.sleep(_INTER_BATCH_DELAY_S)

    embedded: list[EmbeddedChunk] = []
    for chunk, vector in zip(chunks, results):
        assert vector is not None, "BUG: embedding result missing"
        embedded.append(
            EmbeddedChunk(chunk=chunk, dense_vector=vector, embedder_used=model_tag)
        )

    return embedded
