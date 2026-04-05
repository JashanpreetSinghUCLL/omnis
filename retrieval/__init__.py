"""Triple-layer hybrid retrieval pipeline.

Stages
------
1. VectorRetriever  — parallel dense + BM25 sparse search via Qdrant (top-50 each)
2. GraphRetriever   — 2-hop entity expansion via Neo4j VectorCypherRetriever
3. RetrievalFusion  — RRF (k=60) over dense+sparse; attach graph context; top-20
4. Reranker         — Cohere Rerank v3.5 / bge-reranker-base fallback; top-8
"""

from retrieval.fusion import FusedResult, reciprocal_rank_fusion
from retrieval.graph_retriever import GraphContext, GraphRetriever, GraphRetrieverResult
from retrieval.pipeline import HybridRetriever, RetrievalPipelineResult
from retrieval.reranker import RankedResult, Reranker, RerankerResult
from retrieval.vector_retriever import VectorHit, VectorRetriever, VectorRetrieverResult

__all__ = [
    "FusedResult",
    "GraphContext",
    "GraphRetriever",
    "GraphRetrieverResult",
    "HybridRetriever",
    "RankedResult",
    "Reranker",
    "RerankerResult",
    "RetrievalPipelineResult",
    "VectorHit",
    "VectorRetriever",
    "VectorRetrieverResult",
    "reciprocal_rank_fusion",
]
