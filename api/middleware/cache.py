"""3-layer response cache for /v1/ask.

Cache layers
------------
L1 — Exact Redis hash
    Key: sha256(f"{tenant_id}:{question}") stored as  `cache:l1:{hex}`
    Value: JSON-serialised dict of the final answer + citations
    TTL: 1 hour (configurable via Settings.cache_l1_ttl_s)

L2 — Semantic cache via Qdrant
    The question embedding is searched against an `omnis_cache` Qdrant
    collection.  Any hit with cosine similarity ≥ 0.90 is returned.
    Namespace isolation: each tenant has its own Qdrant payload filter.
    TTL: responses carry a `cached_at` timestamp; entries older than
    Settings.cache_l2_ttl_s (24 hours) are filtered out at query time.

L3 — Embedding cache
    The query embedding itself is cached in Redis under
    `cache:emb:{sha256(question)}` (binary float32 array, msgpack-encoded).
    This avoids a second Voyage API call when L2 misses but we need the
    embedding for retrieval.

Usage
-----
    cache = ResponseCache(redis_url=..., qdrant_url=..., embed_fn=...)

    # Before graph execution
    hit = await cache.get(question, tenant_id)
    if hit:
        yield hit  # (layer, cached_response_dict)
        return

    # After graph execution
    await cache.set(question, tenant_id, response_dict, embedding)

The /v1/ask route is the only consumer; the class is not a middleware
(streaming responses make transparent middleware-level caching impractical).
"""

from __future__ import annotations

import hashlib
import json
import logging
import struct
import time
from collections.abc import Awaitable, Callable
from typing import Any, Literal

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

CacheLayer = Literal["L1", "L2", "L3"]
EmbedFn = Callable[[str], Awaitable[list[float]]]

_CACHE_COLLECTION = "omnis_cache"
_L1_TTL_S: int = 3_600  # 1 hour
_L2_TTL_S: int = 86_400  # 24 hours
_L2_THRESHOLD: float = 0.90  # cosine similarity floor


# ── Packing helpers


def _pack_embedding(vec: list[float]) -> bytes:
    """Pack a float32 vector as raw bytes (little-endian)."""
    return struct.pack(f"<{len(vec)}f", *vec)


def _unpack_embedding(data: bytes) -> list[float]:
    n = len(data) // 4
    return list(struct.unpack(f"<{n}f", data))


# ── Key helpers


def _l1_key(tenant_id: str, question: str) -> str:
    digest = hashlib.sha256(f"{tenant_id}:{question}".encode()).hexdigest()
    return f"cache:l1:{digest}"


def _emb_key(question: str) -> str:
    digest = hashlib.sha256(question.encode()).hexdigest()
    return f"cache:emb:{digest}"


# ── Main cache class


class ResponseCache:
    """3-layer cache for question → answer pairs."""

    def __init__(
        self,
        redis_url: str,
        qdrant_url: str,
        embed_fn: EmbedFn,
        qdrant_api_key: str | None = None,
        l1_ttl_s: int = _L1_TTL_S,
        l2_ttl_s: int = _L2_TTL_S,
        l2_threshold: float = _L2_THRESHOLD,
    ) -> None:
        self._redis_url = redis_url
        self._qdrant_url = qdrant_url
        self._qdrant_api_key = qdrant_api_key
        self._embed_fn = embed_fn
        self._l1_ttl_s = l1_ttl_s
        self._l2_ttl_s = l2_ttl_s
        self._l2_threshold = l2_threshold
        self._redis: aioredis.Redis | None = None  # type: ignore[type-arg]

    async def _redis_client(self) -> aioredis.Redis:  # type: ignore[type-arg]
        if self._redis is None:
            self._redis = aioredis.from_url(self._redis_url, decode_responses=False)
        return self._redis

    # ── L1 — exact match

    async def _l1_get(self, tenant_id: str, question: str) -> dict[str, Any] | None:
        try:
            redis = await self._redis_client()
            raw = await redis.get(_l1_key(tenant_id, question))
            if raw:
                return json.loads(raw)  # type: ignore[no-any-return]
        except Exception as exc:
            logger.debug("L1 cache get failed: %s", exc)
        return None

    async def _l1_set(
        self, tenant_id: str, question: str, data: dict[str, Any]
    ) -> None:
        try:
            redis = await self._redis_client()
            await redis.setex(
                _l1_key(tenant_id, question),
                self._l1_ttl_s,
                json.dumps(data),
            )
        except Exception as exc:
            logger.debug("L1 cache set failed: %s", exc)

    # ── L3 — embedding cache

    async def _emb_get(self, question: str) -> list[float] | None:
        try:
            redis = await self._redis_client()
            raw = await redis.get(_emb_key(question))
            if raw:
                return _unpack_embedding(raw)
        except Exception as exc:
            logger.debug("Embedding cache get failed: %s", exc)
        return None

    async def _emb_set(self, question: str, vec: list[float]) -> None:
        try:
            redis = await self._redis_client()
            await redis.setex(
                _emb_key(question),
                self._l2_ttl_s,
                _pack_embedding(vec),
            )
        except Exception as exc:
            logger.debug("Embedding cache set failed: %s", exc)

    # ── L2 — semantic cache via Qdrant

    async def _ensure_cache_collection(self, qdrant: Any, dim: int) -> None:
        """Create omnis_cache collection if it doesn't exist."""
        from qdrant_client.models import Distance, VectorParams  # type: ignore[import-untyped]

        try:
            await qdrant.get_collection(_CACHE_COLLECTION)
        except Exception:
            await qdrant.create_collection(
                collection_name=_CACHE_COLLECTION,
                vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
            )

    async def _l2_get(
        self, tenant_id: str, question: str, embedding: list[float]
    ) -> tuple[dict[str, Any], float] | None:
        """Search Qdrant for a semantically similar cached answer."""
        try:
            from qdrant_client import AsyncQdrantClient  # type: ignore[import-untyped]
            from qdrant_client.models import FieldCondition, Filter, MatchValue  # type: ignore[import-untyped]

            qdrant = AsyncQdrantClient(
                url=self._qdrant_url, api_key=self._qdrant_api_key
            )
            try:
                await self._ensure_cache_collection(qdrant, len(embedding))

                cutoff = time.time() - self._l2_ttl_s
                results = await qdrant.search(
                    collection_name=_CACHE_COLLECTION,
                    query_vector=embedding,
                    limit=1,
                    score_threshold=self._l2_threshold,
                    query_filter=Filter(
                        must=[
                            FieldCondition(
                                key="tenant_id",
                                match=MatchValue(value=tenant_id),
                            ),
                            FieldCondition(
                                key="cached_at",
                                range={"gte": cutoff},
                            ),
                        ]
                    ),
                )
                if results:
                    payload = results[0].payload or {}
                    score = float(results[0].score)
                    cached_data = payload.get("response")
                    if isinstance(cached_data, dict):
                        return cached_data, score
            finally:
                await qdrant.close()
        except Exception as exc:
            logger.debug("L2 cache get failed: %s", exc)
        return None

    async def _l2_set(
        self,
        tenant_id: str,
        question: str,
        embedding: list[float],
        data: dict[str, Any],
    ) -> None:
        """Upsert a cached response into Qdrant."""
        try:
            import hashlib

            from qdrant_client import AsyncQdrantClient  # type: ignore[import-untyped]
            from qdrant_client.models import PointStruct  # type: ignore[import-untyped]

            point_id = int(
                hashlib.sha256(f"{tenant_id}:{question}".encode()).hexdigest()[:15],
                16,
            ) % (2**63)

            qdrant = AsyncQdrantClient(
                url=self._qdrant_url, api_key=self._qdrant_api_key
            )
            try:
                await self._ensure_cache_collection(qdrant, len(embedding))
                await qdrant.upsert(
                    collection_name=_CACHE_COLLECTION,
                    points=[
                        PointStruct(
                            id=point_id,
                            vector=embedding,
                            payload={
                                "tenant_id": tenant_id,
                                "question": question,
                                "response": data,
                                "cached_at": time.time(),
                            },
                        )
                    ],
                )
            finally:
                await qdrant.close()
        except Exception as exc:
            logger.debug("L2 cache set failed: %s", exc)

    # ── Public API

    async def get(
        self, question: str, tenant_id: str
    ) -> tuple[CacheLayer, dict[str, Any], float | None] | None:
        """Try each cache layer in order.

        Returns (layer, response_dict, similarity_score) on hit, None on miss.
        similarity_score is None for L1 (exact match).
        """
        # L1: exact hash
        hit = await self._l1_get(tenant_id, question)
        if hit is not None:
            logger.info("Cache HIT L1 [tenant=%s]", tenant_id)
            return "L1", hit, None

        # L3: try to get cached embedding to avoid an API call
        embedding = await self._emb_get(question)

        if embedding is None:
            # Must call the embed function; cache it for L3 afterward
            try:
                embedding = await self._embed_fn(question)
                await self._emb_set(question, embedding)
            except Exception as exc:
                logger.warning("Embed for cache lookup failed: %s", exc)
                return None

        # L2: semantic similarity
        l2_result = await self._l2_get(tenant_id, question, embedding)
        if l2_result is not None:
            cached_data, score = l2_result
            logger.info("Cache HIT L2 [tenant=%s similarity=%.3f]", tenant_id, score)
            return "L2", cached_data, score

        return None

    async def set(
        self,
        question: str,
        tenant_id: str,
        response: dict[str, Any],
        embedding: list[float] | None = None,
    ) -> None:
        """Store response in L1 (always) and L2 (if embedding provided)."""
        await self._l1_set(tenant_id, question, response)

        if embedding is not None:
            await self._emb_set(question, embedding)
            await self._l2_set(tenant_id, question, embedding, response)

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None
