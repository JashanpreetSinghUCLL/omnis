"""Neo4j knowledge-graph retriever with 2-hop entity expansion.

Uses neo4j-graphrag VectorCypherRetriever against the chunk_embeddings vector
index created by the SimpleKGPipeline ingestion stage.

Every Cypher query applies a tenant_id guard on the matched __Chunk__ node so
results are isolated per tenant.  Chunks ingested without an explicit tenant_id
are treated as globally accessible (NULL-safe guard).

The retriever runs synchronously inside a thread-pool executor so it never
blocks the asyncio event loop.
"""

from __future__ import annotations

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from ingestion.embed_config import LOCAL_EMBED_MODEL

logger = logging.getLogger(__name__)

# ── Constants

# Must match the index created by SimpleKGPipeline (default name).
_VECTOR_INDEX = "chunk_embeddings"

# Same model used during graph ingestion (graph_builder._make_fastembed_embedder).
_EMBED_MODEL = LOCAL_EMBED_MODEL

# Top-k chunks to retrieve from the vector index before expansion.
_DEFAULT_TOP_K = 10

# ── 2-hop expansion Cypher
#
# Starting point: `node` (__Chunk__) and `score` are already bound by the
# VectorCypherRetriever's CALL db.index.vector.queryNodes(...) YIELD node, score
#
# Tenant guard:  NULL-safe so chunks without tenant_id are visible to everyone.
# Expansion:     hop-1 → direct entities mentioned in the chunk
#                hop-2 → entities connected to those entities
# List slices:   prevent huge RETURN payloads on dense graphs.

_RETRIEVAL_QUERY = """
WITH node, score
WHERE node.tenant_id IS NULL OR node.tenant_id = $tenant_id
OPTIONAL MATCH (node)-[:MENTIONS]->(e:__Entity__)
OPTIONAL MATCH (e)-[r1]-(n1:__Entity__)
OPTIONAL MATCH (n1)-[r2]-(n2:__Entity__)
WITH node, score,
     collect(DISTINCT {
         name:  e.name,
         label: [l IN labels(e) WHERE l <> '__Entity__'][0]
     })[0..20] AS entities,
     collect(DISTINCT {
         from: e.name,
         type: type(r1),
         to:   n1.name
     })[0..40] AS hop1,
     collect(DISTINCT {
         from: n1.name,
         type: type(r2),
         to:   n2.name
     })[0..40] AS hop2
RETURN {
    text:           node.text,
    entities:       entities,
    hop1_relations: hop1,
    hop2_relations: hop2
} AS output, score
"""


# ── Data models


@dataclass
class GraphContext:
    """Structured context from a single retrieved chunk + its graph neighbourhood."""

    chunk_text: str
    entities: list[dict[str, str]]  # [{name, label}]
    hop1_relations: list[dict[str, str]]  # [{from, type, to}]
    hop2_relations: list[dict[str, str]]  # [{from, type, to}]
    score: float


@dataclass
class GraphRetrieverResult:
    contexts: list[GraphContext] = field(default_factory=list)
    latency_ms: float = 0.0
    entity_count: int = 0
    relation_count: int = 0


# ── Retriever


class GraphRetriever:
    """Async wrapper around neo4j-graphrag VectorCypherRetriever.

    The underlying Neo4j driver is synchronous; all blocking calls are
    dispatched to a dedicated thread-pool executor.
    """

    def __init__(
        self,
        neo4j_uri: str = "bolt://localhost:7687",
        neo4j_user: str = "neo4j",
        neo4j_password: str = "omnis_dev_password",
        index_name: str = _VECTOR_INDEX,
        top_k: int = _DEFAULT_TOP_K,
    ) -> None:
        self._uri = neo4j_uri
        self._user = neo4j_user
        self._password = neo4j_password
        self._index = index_name
        self._top_k = top_k
        # 2 workers: one for the retriever call, one spare for init
        self._executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="neo4j-ret"
        )
        self._retriever: Any = None
        self._driver: Any = None

    # ── Lazy init (sync; called from executor thread)

    def _init(self) -> None:
        """Initialise the Neo4j driver + VectorCypherRetriever (idempotent)."""
        if self._retriever is not None:
            return

        import neo4j  # type: ignore[import-untyped]
        from fastembed import TextEmbedding  # type: ignore[import-untyped]
        from neo4j_graphrag.embeddings import Embedder  # type: ignore[import-untyped]
        from neo4j_graphrag.retrievers import VectorCypherRetriever  # type: ignore[import-untyped]

        class _BGEEmbedder(Embedder):
            """Wraps BAAI/bge-large-en-v1.5 via fastembed."""

            def __init__(self) -> None:
                super().__init__()
                self._model = TextEmbedding(_EMBED_MODEL)

            def embed_query(self, text: str) -> list[float]:
                return next(iter(self._model.embed([text]))).tolist()

        self._driver = neo4j.GraphDatabase.driver(
            self._uri, auth=(self._user, self._password)
        )
        self._retriever = VectorCypherRetriever(
            driver=self._driver,
            index_name=self._index,
            embedder=_BGEEmbedder(),
            retrieval_query=_RETRIEVAL_QUERY,
        )
        logger.info("GraphRetriever initialised (index=%r)", self._index)

    # ── Sync search (runs in executor)

    def _sync_search(self, query_text: str, tenant_id: str) -> list[GraphContext]:
        self._init()

        result = self._retriever.search(
            query_text=query_text,
            top_k=self._top_k,
            query_params={"tenant_id": tenant_id},
        )

        contexts: list[GraphContext] = []
        for item in result.items:
            raw = item.content
            # Normalise: content can be a dict or a plain string
            if isinstance(raw, dict):
                output: dict[str, Any] = raw.get("output", raw)
            else:
                output = {"text": str(raw)}

            score = float(getattr(item, "score", 0.0) or 0.0)
            # neo4j-graphrag stores score in metadata for some versions
            if score == 0.0 and hasattr(item, "metadata") and item.metadata:
                score = float(item.metadata.get("score", 0.0) or 0.0)

            contexts.append(
                GraphContext(
                    chunk_text=output.get("text", "") or "",
                    entities=output.get("entities", []) or [],
                    hop1_relations=output.get("hop1_relations", []) or [],
                    hop2_relations=output.get("hop2_relations", []) or [],
                    score=score,
                )
            )
        return contexts

    # ── Async public API

    async def retrieve(
        self,
        query_text: str,
        tenant_id: str = "default",
    ) -> GraphRetrieverResult:
        """Expand top vector-matched chunks 2 hops through the knowledge graph.

        Args:
            query_text: Raw query string (embedded internally with BGE-M3).
            tenant_id:  Filters chunks to this tenant; NULL-safe for legacy data.

        Returns:
            Up to top_k GraphContext objects with entities + hop-1/hop-2 relations.
        """
        t0 = time.perf_counter()
        loop = asyncio.get_running_loop()

        try:
            contexts = await loop.run_in_executor(
                self._executor,
                self._sync_search,
                query_text,
                tenant_id,
            )
        except Exception as exc:
            logger.warning("GraphRetriever failed: %s", exc)
            contexts = []

        ms = (time.perf_counter() - t0) * 1000
        entity_count = sum(len(c.entities) for c in contexts)
        relation_count = sum(
            len(c.hop1_relations) + len(c.hop2_relations) for c in contexts
        )

        logger.info(
            "GraphRetriever | %.1fms | contexts=%d entities=%d relations=%d",
            ms,
            len(contexts),
            entity_count,
            relation_count,
        )
        return GraphRetrieverResult(
            contexts=contexts,
            latency_ms=ms,
            entity_count=entity_count,
            relation_count=relation_count,
        )

    def close(self) -> None:
        if self._driver is not None:
            self._driver.close()
        self._executor.shutdown(wait=False)
