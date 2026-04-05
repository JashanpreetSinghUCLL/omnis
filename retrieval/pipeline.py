"""Top-level hybrid retrieval orchestrator.

Full pipeline per query
-----------------------
1. Vector retrieval  — dense + BM25 sparse in parallel (top-50 each)      ┐
   Graph retrieval   — 2-hop entity expansion                              ┘ parallel
2. RRF fusion        — merge dense + sparse; attach graph context; top-20
3. Reranking         — Cohere v3.5 / bge-reranker-base; top-8

Latency target: P95 < 600 ms end-to-end.
Per-stage breakdown is logged at INFO level on every call.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

from retrieval.fusion import FusedResult, reciprocal_rank_fusion
from retrieval.graph_retriever import GraphRetriever, GraphRetrieverResult
from retrieval.reranker import RankedResult, Reranker
from retrieval.vector_retriever import VectorRetriever, VectorRetrieverResult

logger = logging.getLogger(__name__)


# ── Result model


@dataclass
class RetrievalPipelineResult:
    """Full result with per-stage latency breakdown."""

    query: str
    tenant_id: str

    # Final reranked top-8
    ranked: list[RankedResult] = field(default_factory=list)
    reranker_backend: str = "passthrough"

    # Intermediate pools (useful for debugging/eval)
    fused_pool: list[FusedResult] = field(default_factory=list)
    vector_result: VectorRetrieverResult | None = None
    graph_result: GraphRetrieverResult | None = None

    # Per-stage latency (milliseconds)
    vector_latency_ms: float = 0.0
    graph_latency_ms: float = 0.0
    fusion_latency_ms: float = 0.0
    rerank_latency_ms: float = 0.0
    total_latency_ms: float = 0.0

    @property
    def texts(self) -> list[str]:
        """Convenience: ordered list of top result texts."""
        return [r.fused.text for r in self.ranked]


# ── Pipeline


class HybridRetriever:
    """Orchestrates VectorRetriever → GraphRetriever → RRF → Reranker.

    Vector and graph retrieval run concurrently; fusion and reranking are
    sequential (each depends on the previous stage's output).
    """

    def __init__(
        self,
        # Qdrant
        qdrant_url: str = "http://localhost:6333",
        qdrant_api_key: str | None = None,
        collection: str = "omnis_docs",
        # Neo4j
        neo4j_uri: str = "bolt://localhost:7687",
        neo4j_user: str = "neo4j",
        neo4j_password: str = "omnis_dev_password",
        neo4j_index: str = "chunk_embeddings",
        # Reranker
        cohere_api_key: str | None = None,
        # Retrieval sizes
        vector_top_k: int = 50,
        graph_top_k: int = 10,
        rerank_top_n: int = 8,
        rrf_pool: int = 20,
    ) -> None:
        self._vector = VectorRetriever(
            qdrant_url=qdrant_url,
            qdrant_api_key=qdrant_api_key,
            collection=collection,
            top_k=vector_top_k,
        )
        self._graph = GraphRetriever(
            neo4j_uri=neo4j_uri,
            neo4j_user=neo4j_user,
            neo4j_password=neo4j_password,
            index_name=neo4j_index,
            top_k=graph_top_k,
        )
        self._reranker = Reranker(
            cohere_api_key=cohere_api_key,
            top_n=rerank_top_n,
        )
        self._rrf_pool = rrf_pool

    async def retrieve(
        self,
        query_text: str,
        query_vector: list[float],
        tenant_id: str = "default",
    ) -> RetrievalPipelineResult:
        """Run the full hybrid retrieval pipeline.

        Args:
            query_text:   Raw query string (used for BM25 + graph embedding).
            query_vector: Pre-computed dense embedding for Qdrant dense search.
            tenant_id:    Scopes all retrieval to a single tenant.

        Returns:
            RetrievalPipelineResult with top-8 ranked results and latency breakdown.
        """
        pipeline_start = time.perf_counter()

        # ── Stage 1: Vector + Graph retrieval in parallel ─────────────────────
        vec_task = self._vector.retrieve(
            query_vector=query_vector,
            query_text=query_text,
            tenant_id=tenant_id,
        )
        graph_task = self._graph.retrieve(
            query_text=query_text,
            tenant_id=tenant_id,
        )
        vec_result, graph_result = await asyncio.gather(vec_task, graph_task)

        # ── Stage 2: RRF fusion
        t_fusion = time.perf_counter()
        fused_pool = reciprocal_rank_fusion(
            dense_hits=vec_result.dense_hits,
            sparse_hits=vec_result.sparse_hits,
            graph_contexts=graph_result.contexts,
            final_pool=self._rrf_pool,
        )
        fusion_ms = (time.perf_counter() - t_fusion) * 1000

        # ── Stage 3: Reranking
        rerank_result = await self._reranker.rerank(
            query=query_text,
            candidates=fused_pool,
        )

        total_ms = (time.perf_counter() - pipeline_start) * 1000

        logger.info(
            "Pipeline | total=%.1fms | vector=%.1fms graph=%.1fms "
            "fusion=%.1fms rerank=%.1fms | "
            "dense=%d sparse=%d fused=%d ranked=%d backend=%s",
            total_ms,
            vec_result.total_latency_ms,
            graph_result.latency_ms,
            fusion_ms,
            rerank_result.latency_ms,
            len(vec_result.dense_hits),
            len(vec_result.sparse_hits),
            len(fused_pool),
            len(rerank_result.ranked),
            rerank_result.backend,
        )

        return RetrievalPipelineResult(
            query=query_text,
            tenant_id=tenant_id,
            ranked=rerank_result.ranked,
            reranker_backend=rerank_result.backend,
            fused_pool=fused_pool,
            vector_result=vec_result,
            graph_result=graph_result,
            vector_latency_ms=vec_result.total_latency_ms,
            graph_latency_ms=graph_result.latency_ms,
            fusion_latency_ms=fusion_ms,
            rerank_latency_ms=rerank_result.latency_ms,
            total_latency_ms=total_ms,
        )

    async def close(self) -> None:
        await self._vector.close()
        self._graph.close()
