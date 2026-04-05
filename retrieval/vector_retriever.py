"""Parallel dense + sparse (BM25) retrieval from Qdrant.

Both searches run concurrently via asyncio.gather — neither blocks the other.
Returns top-50 hits from each arm.

Sparse tokenization mirrors ingestion/vector_store._to_sparse_vector exactly
(MD5-bucketed TF, IDF applied server-side) so query tokens land in the same
buckets as indexed document tokens.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from collections import Counter
from dataclasses import dataclass, field

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (  # type: ignore[import-untyped]
    FieldCondition,
    Filter,
    MatchValue,
    SparseVector,
)

logger = logging.getLogger(__name__)

_SPARSE_BUCKET_SIZE = 2**20  # must match vector_store._SPARSE_BUCKET_SIZE
_DEFAULT_COLLECTION = "omnis_docs"
_DEFAULT_TOP_K = 50


# ── Sparse vector helpers


def _to_sparse_vector(text: str) -> tuple[list[int], list[float]]:
    """Mirror of ingestion/vector_store._to_sparse_vector.

    Converts query text to normalised TF sparse vector using the same MD5
    bucketing scheme so query tokens align with indexed document tokens.
    IDF weighting is applied server-side via Modifier.IDF.
    """
    tokens = re.findall(r"\b\w+\b", text.lower())
    if not tokens:
        return [], []

    tf = Counter(tokens)
    total = sum(tf.values())

    bucket_tf: dict[int, int] = {}
    for term, count in tf.items():
        bucket = int(hashlib.md5(term.encode()).hexdigest(), 16) % _SPARSE_BUCKET_SIZE
        bucket_tf[bucket] = bucket_tf.get(bucket, 0) + count

    indices = list(bucket_tf.keys())
    values = [count / total for count in bucket_tf.values()]
    return indices, values


def _tenant_filter(tenant_id: str) -> Filter:
    return Filter(
        must=[FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))]
    )


# ── Data models


@dataclass
class VectorHit:
    """Single hit from a Qdrant search (dense or sparse)."""

    id: str
    score: float
    text: str
    source: str
    page: int
    chunk_index: int
    tenant_id: str
    retrieval_type: str  # "dense" | "sparse"


@dataclass
class VectorRetrieverResult:
    dense_hits: list[VectorHit] = field(default_factory=list)
    sparse_hits: list[VectorHit] = field(default_factory=list)
    dense_latency_ms: float = 0.0
    sparse_latency_ms: float = 0.0
    total_latency_ms: float = 0.0


# ── Retriever


class VectorRetriever:
    """Concurrent dense + BM25 sparse retrieval via Qdrant async client."""

    def __init__(
        self,
        qdrant_url: str = "http://localhost:6333",
        qdrant_api_key: str | None = None,
        collection: str = _DEFAULT_COLLECTION,
        top_k: int = _DEFAULT_TOP_K,
    ) -> None:
        self._client = AsyncQdrantClient(url=qdrant_url, api_key=qdrant_api_key)
        self._collection = collection
        self._top_k = top_k

    async def _search_dense(
        self,
        query_vector: list[float],
        tenant_id: str,
    ) -> tuple[list[VectorHit], float]:
        t0 = time.perf_counter()
        response = await self._client.query_points(
            collection_name=self._collection,
            query=query_vector,
            using="dense",
            query_filter=_tenant_filter(tenant_id),
            limit=self._top_k,
            with_payload=True,
        )
        ms = (time.perf_counter() - t0) * 1000

        hits = [
            VectorHit(
                id=str(p.id),
                score=p.score,
                text=p.payload.get("text", "") if p.payload else "",
                source=p.payload.get("source", "") if p.payload else "",
                page=p.payload.get("page", -1) if p.payload else -1,
                chunk_index=p.payload.get("chunk_index", -1) if p.payload else -1,
                tenant_id=(
                    p.payload.get("tenant_id", tenant_id) if p.payload else tenant_id
                ),
                retrieval_type="dense",
            )
            for p in response.points
        ]
        logger.debug("Dense search: %d hits in %.1f ms", len(hits), ms)
        return hits, ms

    async def _search_sparse(
        self,
        query_text: str,
        tenant_id: str,
    ) -> tuple[list[VectorHit], float]:
        indices, values = _to_sparse_vector(query_text)
        if not indices:
            return [], 0.0

        t0 = time.perf_counter()
        response = await self._client.query_points(
            collection_name=self._collection,
            query=SparseVector(indices=indices, values=values),
            using="sparse",
            query_filter=_tenant_filter(tenant_id),
            limit=self._top_k,
            with_payload=True,
        )
        ms = (time.perf_counter() - t0) * 1000

        hits = [
            VectorHit(
                id=str(p.id),
                score=p.score,
                text=p.payload.get("text", "") if p.payload else "",
                source=p.payload.get("source", "") if p.payload else "",
                page=p.payload.get("page", -1) if p.payload else -1,
                chunk_index=p.payload.get("chunk_index", -1) if p.payload else -1,
                tenant_id=(
                    p.payload.get("tenant_id", tenant_id) if p.payload else tenant_id
                ),
                retrieval_type="sparse",
            )
            for p in response.points
        ]
        logger.debug("Sparse search: %d hits in %.1f ms", len(hits), ms)
        return hits, ms

    async def retrieve(
        self,
        query_vector: list[float],
        query_text: str,
        tenant_id: str = "default",
    ) -> VectorRetrieverResult:
        """Run dense + sparse Qdrant search in parallel.

        Args:
            query_vector: Pre-computed dense embedding (must match collection dims).
            query_text:   Raw query string for BM25 tokenisation.
            tenant_id:    Filters results to a single tenant's documents.

        Returns:
            Up to top_k dense hits and top_k sparse hits, with per-arm latency.
        """
        t0 = time.perf_counter()
        (dense_hits, dense_ms), (sparse_hits, sparse_ms) = await asyncio.gather(
            self._search_dense(query_vector, tenant_id),
            self._search_sparse(query_text, tenant_id),
        )
        total_ms = (time.perf_counter() - t0) * 1000

        logger.info(
            "VectorRetriever | dense=%.1fms sparse=%.1fms total=%.1fms "
            "dense_hits=%d sparse_hits=%d",
            dense_ms,
            sparse_ms,
            total_ms,
            len(dense_hits),
            len(sparse_hits),
        )
        return VectorRetrieverResult(
            dense_hits=dense_hits,
            sparse_hits=sparse_hits,
            dense_latency_ms=dense_ms,
            sparse_latency_ms=sparse_ms,
            total_latency_ms=total_ms,
        )

    async def close(self) -> None:
        await self._client.close()
