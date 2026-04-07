"""Qdrant vector store writer.

Pushes embedded chunks to Qdrant with:
- Dense vectors  (Cohere embed-v4 / BGE-M3)
- Sparse vectors (BM25 term frequencies; IDF applied server-side)

Collection is created on first use with both vector types enabled.

Payload per point
-----------------
  tenant_id    str   – multi-tenant isolation key
  source       str   – file name or URL of the source document
  page         int   – page number (or -1 if unknown)
  chunk_index  int   – position within the document
  created_at   str   – ISO-8601 UTC timestamp
  text         str   – raw chunk text (enables full-text lookup)
"""

from __future__ import annotations

import hashlib
import logging
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from ingestion.embedder import EmbeddedChunk
from ingestion.embed_config import LOCAL_EMBED_MODEL, LOCAL_EMBED_DIMS

logger = logging.getLogger(__name__)

# Qdrant sparse vector index size (2^20 buckets ≈ 1M; enough for large corpora)
_SPARSE_BUCKET_BITS = 20
_SPARSE_BUCKET_SIZE = 2**_SPARSE_BUCKET_BITS

# voyage-4-large → 2048 dims.  Local fallback → LOCAL_EMBED_DIMS.  Inferred at runtime.
_DENSE_DIMS: dict[str, int] = {
    "voyage-4-large": 2048,
    LOCAL_EMBED_MODEL: LOCAL_EMBED_DIMS,
}


# ── Sparse vector helpers ─────────────────────────────────────────────────────


def _tokenize(text: str) -> list[str]:
    return re.findall(r"\b\w+\b", text.lower())


def _to_sparse_vector(text: str) -> tuple[list[int], list[float]]:
    """Convert *text* to a normalised TF sparse vector.

    Returns (indices, values) suitable for Qdrant SparseVector.
    IDF weighting is applied server-side via Modifier.IDF.
    """
    tokens = _tokenize(text)
    if not tokens:
        return [], []

    tf = Counter(tokens)
    total = sum(tf.values())

    # Hash collisions are possible with bucketed sparse vectors.
    # Aggregate per bucket so Qdrant receives unique sparse indices.
    bucket_tf: dict[int, int] = {}
    for term, count in tf.items():
        bucket = int(hashlib.md5(term.encode()).hexdigest(), 16) % _SPARSE_BUCKET_SIZE
        bucket_tf[bucket] = bucket_tf.get(bucket, 0) + count

    indices = list(bucket_tf.keys())
    values = [count / total for count in bucket_tf.values()]

    return indices, values


# ── Collection bootstrap ──────────────────────────────────────────────────────


async def _ensure_collection(
    client: Any,
    collection_name: str,
    dense_dim: int,
) -> None:
    """Create the collection if it does not already exist."""
    from qdrant_client.models import (  # type: ignore[import-untyped]
        Distance,
        Modifier,
        SparseIndexParams,
        SparseVectorParams,
        VectorParams,
    )

    existing = {c.name for c in (await client.get_collections()).collections}
    if collection_name in existing:
        return

    logger.info("Creating Qdrant collection %r (dim=%d)", collection_name, dense_dim)
    await client.create_collection(
        collection_name=collection_name,
        # Pass a dict — VectorsConfig is a Union alias, not a concrete class
        vectors_config={
            "dense": VectorParams(size=dense_dim, distance=Distance.COSINE)
        },
        sparse_vectors_config={
            "sparse": SparseVectorParams(
                index=SparseIndexParams(on_disk=False),
                modifier=Modifier.IDF,
            )
        },
    )


# ── Point ID derivation ───────────────────────────────────────────────────────


def _point_id(source_hash: str, chunk_index: int) -> str:
    """Stable UUID-like ID from source hash + chunk position.

    Qdrant accepts UUID strings as point IDs.
    """
    raw = f"{source_hash}:{chunk_index}".encode()
    digest = hashlib.sha256(raw).hexdigest()
    # Format as UUID v4 (just for Qdrant ID compatibility)
    return str(UUID(digest[:32]))


# ── Public API ────────────────────────────────────────────────────────────────


async def push_to_qdrant(
    embedded_chunks: list[EmbeddedChunk],
    qdrant_client: Any,
    collection_name: str = "omnis_docs",
    tenant_id: str = "default",
    source: str = "",
) -> int:
    """Upsert *embedded_chunks* into Qdrant.

    Returns the number of points written.
    """
    from qdrant_client.models import (  # type: ignore[import-untyped]
        PointStruct,
        SparseVector,
    )

    if not embedded_chunks:
        return 0

    # Infer dense dimension from the first chunk's embedder
    first_embedder = embedded_chunks[0].embedder_used
    dense_dim = _DENSE_DIMS.get(first_embedder, len(embedded_chunks[0].dense_vector))

    await _ensure_collection(qdrant_client, collection_name, dense_dim)

    now_iso = datetime.now(tz=timezone.utc).isoformat()
    points: list[Any] = []

    for ec in embedded_chunks:
        chunk = ec.chunk
        sparse_indices, sparse_values = _to_sparse_vector(chunk.text)

        point = PointStruct(
            id=_point_id(chunk.source_hash, chunk.chunk_index),
            vector={
                "dense": ec.dense_vector,
                "sparse": SparseVector(indices=sparse_indices, values=sparse_values),
            },
            payload={
                "tenant_id": tenant_id,
                "source": source or str(chunk.source_hash[:8]),
                "page": chunk.page_hint if chunk.page_hint is not None else -1,
                "chunk_index": chunk.chunk_index,
                "created_at": now_iso,
                "text": chunk.text,
            },
        )
        points.append(point)

    # Upsert in batches of 256 (Qdrant recommended max)
    _BATCH = 256
    written = 0
    for start in range(0, len(points), _BATCH):
        batch = points[start : start + _BATCH]
        await qdrant_client.upsert(collection_name=collection_name, points=batch)
        written += len(batch)
        logger.debug("Upserted %d points to %r", len(batch), collection_name)

    logger.info("Pushed %d vectors to Qdrant collection %r", written, collection_name)
    return written
