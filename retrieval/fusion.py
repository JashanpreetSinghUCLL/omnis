"""Reciprocal Rank Fusion (RRF) over dense + sparse results with graph context.

Algorithm
---------
RRF score for a document d across ranked lists L₁ … Lₙ:

    score(d) = Σ  1 / (k + rank(d, Lᵢ))   where k = 60

k=60 is the standard value from Cormack et al. 2009; it down-weights the
contribution of very high ranks while keeping low-ranked documents meaningful.

After scoring, the top-20 documents are selected and each has relevant
GraphContext objects attached via a Jaccard-overlap heuristic on chunk text.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from retrieval.graph_retriever import GraphContext
from retrieval.vector_retriever import VectorHit

logger = logging.getLogger(__name__)

_RRF_K = 60
_FINAL_POOL = 20
_MIN_GRAPH_OVERLAP = 0.10  # Minimum Jaccard similarity to attach a GraphContext
_MAX_GRAPH_ATTACH = 3  # Maximum GraphContext objects per result


# ── Data model


@dataclass
class FusedResult:
    """A single document after RRF fusion with optional graph context."""

    id: str
    text: str
    source: str
    page: int
    chunk_index: int
    tenant_id: str
    rrf_score: float
    dense_rank: int | None = None  # rank in dense list (1-based), None if absent
    sparse_rank: int | None = None  # rank in sparse list (1-based), None if absent
    graph_contexts: list[GraphContext] = field(default_factory=list)


# ── RRF implementation


def _rrf_score(rank: int, k: int = _RRF_K) -> float:
    return 1.0 / (k + rank)


def _jaccard(a: str, b: str) -> float:
    """Token-level Jaccard similarity between two strings."""
    wa = set(a.lower().split())
    wb = set(b.lower().split())
    union = wa | wb
    if not union:
        return 0.0
    return len(wa & wb) / len(union)


def _attach_graph_contexts(
    chunk_text: str,
    contexts: list[GraphContext],
) -> list[GraphContext]:
    """Return up to _MAX_GRAPH_ATTACH contexts with sufficient text overlap."""
    if not contexts or not chunk_text:
        return []

    scored = [
        (ctx, _jaccard(chunk_text, ctx.chunk_text))
        for ctx in contexts
        if ctx.chunk_text
    ]
    scored.sort(key=lambda x: x[1], reverse=True)

    return [ctx for ctx, sim in scored[:_MAX_GRAPH_ATTACH] if sim >= _MIN_GRAPH_OVERLAP]


# ── Public API


def reciprocal_rank_fusion(
    dense_hits: list[VectorHit],
    sparse_hits: list[VectorHit],
    graph_contexts: list[GraphContext],
    k: int = _RRF_K,
    final_pool: int = _FINAL_POOL,
) -> list[FusedResult]:
    """Fuse dense + sparse ranked lists with RRF and attach graph context.

    Args:
        dense_hits:     Ranked hits from dense (semantic) search.
        sparse_hits:    Ranked hits from BM25 sparse search.
        graph_contexts: Knowledge-graph context objects to attach to results.
        k:              RRF smoothing constant (default 60).
        final_pool:     Number of top results to return (default 20).

    Returns:
        Up to final_pool FusedResult objects sorted by descending RRF score.
    """
    # Accumulator: doc_id → running metadata + score
    acc: dict[str, dict[str, Any]] = {}

    def _upsert(hit: VectorHit) -> dict[str, Any]:
        if hit.id not in acc:
            acc[hit.id] = {
                "text": hit.text,
                "source": hit.source,
                "page": hit.page,
                "chunk_index": hit.chunk_index,
                "tenant_id": hit.tenant_id,
                "rrf_score": 0.0,
                "dense_rank": None,
                "sparse_rank": None,
            }
        return acc[hit.id]

    for rank, hit in enumerate(dense_hits, start=1):
        entry = _upsert(hit)
        entry["rrf_score"] += _rrf_score(rank, k)
        entry["dense_rank"] = rank

    for rank, hit in enumerate(sparse_hits, start=1):
        entry = _upsert(hit)
        entry["rrf_score"] += _rrf_score(rank, k)
        # Keep the better (lower) sparse rank if hit appears twice
        if entry["sparse_rank"] is None or rank < entry["sparse_rank"]:
            entry["sparse_rank"] = rank

    # Sort by fused score → take top-N
    top_ids = sorted(acc, key=lambda i: acc[i]["rrf_score"], reverse=True)[:final_pool]

    results: list[FusedResult] = []
    for doc_id in top_ids:
        e = acc[doc_id]
        fused = FusedResult(
            id=doc_id,
            text=e["text"],
            source=e["source"],
            page=e["page"],
            chunk_index=e["chunk_index"],
            tenant_id=e["tenant_id"],
            rrf_score=e["rrf_score"],
            dense_rank=e["dense_rank"],
            sparse_rank=e["sparse_rank"],
            graph_contexts=_attach_graph_contexts(e["text"], graph_contexts),
        )
        results.append(fused)

    both = sum(
        1
        for e in acc.values()
        if e["dense_rank"] is not None and e["sparse_rank"] is not None
    )
    logger.info(
        "RRF fusion | k=%d dense=%d sparse=%d pool=%d both=%d graph_ctxs=%d",
        k,
        len(dense_hits),
        len(sparse_hits),
        len(results),
        both,
        len(graph_contexts),
    )
    return results
