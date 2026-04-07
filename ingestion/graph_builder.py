"""Neo4j knowledge-graph builder.

Uses neo4j-graphrag 1.14.x SimpleKGPipeline.

Key facts about the actual API (learned from the installed package):
- entities / relations must be plain strings (label names) or dicts
- driver must be a SYNC neo4j.Driver (not async)
- embedder must inherit from neo4j_graphrag.embeddings.Embedder
- perform_entity_resolution=True runs SpaCy+Fuzzy resolvers automatically
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from ingestion.chunker import Chunk

logger = logging.getLogger(__name__)

_MIN_ENTITY_DEGREE = 3


@dataclass
class GraphBuildStats:
    chunks_processed: int = 0
    errors: list[str] = field(default_factory=list)
    entities_before_cleanup: int = 0
    entities_after_cleanup: int = 0
    duplicate_entity_groups: int = 0
    duplicate_entity_rows: int = 0
    entities_merged: int = 0
    entities_pruned: int = 0
    relation_count: int = 0
    avg_relations_per_entity: float = 0.0
    entity_resolution_rate: float = 0.0


# ── Schema — plain strings as required by EntityInputType / RelationInputType ─

_ENTITY_LABELS: list[str] = [
    "Concept",
    "Technology",
    "API",
    "Function",
    "Module",
]

_RELATION_LABELS: list[str] = [
    "DEPENDS_ON",
    "IMPLEMENTS",
    "CALLS",
    "CONFIGURES",
    "EXTENDS",
    "USES",
    "DEFINES",
    "CONTAINS",
    "REFERENCES",
]

_POTENTIAL_SCHEMA: list[tuple[str, str, str]] = [
    ("Technology", "DEPENDS_ON", "Technology"),
    ("Technology", "IMPLEMENTS", "Concept"),
    ("Technology", "USES", "API"),
    ("Module", "CONTAINS", "Function"),
    ("Module", "CONTAINS", "API"),
    ("Module", "DEFINES", "Concept"),
    ("Function", "CALLS", "API"),
    ("Function", "CALLS", "Function"),
    ("Function", "USES", "Technology"),
    ("API", "REFERENCES", "Concept"),
    ("Concept", "EXTENDS", "Concept"),
    ("Concept", "REFERENCES", "Technology"),
]


# ── Embedder — must inherit from neo4j_graphrag.embeddings.Embedder ───────────


def _make_fastembed_embedder() -> Any:
    """Return a neo4j-graphrag Embedder backed by fastembed (already installed)."""
    from neo4j_graphrag.embeddings import Embedder  # type: ignore[import-untyped]
    from fastembed import TextEmbedding  # type: ignore[import-untyped]
    from ingestion.embed_config import LOCAL_EMBED_MODEL

    class _FastEmbedEmbedder(Embedder):
        def __init__(self) -> None:
            super().__init__()
            self._model = TextEmbedding(LOCAL_EMBED_MODEL)

        def embed_query(self, text: str) -> list[float]:
            return next(iter(self._model.embed([text]))).tolist()

    return _FastEmbedEmbedder()


def _run_scalar(
    session: Any, query: str, params: dict[str, Any] | None = None
) -> dict[str, Any]:
    record = session.run(query, params or {}).single()
    return dict(record) if record is not None else {}


def _cleanup_duplicate_entities(session: Any) -> tuple[int, int]:
    query = """
    MATCH (e:__Entity__)
    WHERE e.name IS NOT NULL
    WITH toLower(trim(e.name)) AS normalized_name,
         apoc.coll.sort([label IN labels(e) WHERE label <> '__Entity__' | label]) AS semantic_labels,
         collect(e) AS nodes
    WHERE size(nodes) > 1
    CALL apoc.refactor.mergeNodes(nodes, {properties: 'overwrite', mergeRels: true}) YIELD node
    WITH count(node) AS merged_groups, coalesce(sum(size(nodes) - 1), 0) AS merged_rows
    RETURN merged_groups, merged_rows
    """
    rec = _run_scalar(session, query)
    return int(rec.get("merged_groups", 0) or 0), int(rec.get("merged_rows", 0) or 0)


def _prune_low_degree_entities(session: Any, min_degree: int) -> int:
    query = """
    MATCH (e:__Entity__)
    OPTIONAL MATCH (e)-[r]-()
    WITH e, count(r) AS degree
    WHERE degree < $min_degree
    WITH collect(e) AS doomed, count(e) AS doomed_count
    UNWIND doomed AS entity
    DETACH DELETE entity
    RETURN doomed_count AS pruned
    """
    rec = _run_scalar(session, query, {"min_degree": min_degree})
    return int(rec.get("pruned", 0) or 0)


def _collect_graph_stats(session: Any) -> dict[str, Any]:
    entity_count = _run_scalar(
        session, "MATCH (e:__Entity__) RETURN count(e) AS c"
    ).get("c", 0)
    relation_count = _run_scalar(
        session,
        "MATCH (e:__Entity__)-[r]-() RETURN count(r) AS c",
    ).get("c", 0)
    duplicate_stats = _run_scalar(
        session,
        """
        MATCH (e:__Entity__)
        WHERE e.name IS NOT NULL
        WITH toLower(trim(e.name)) AS normalized_name, count(*) AS c
        WHERE normalized_name <> '' AND c > 1
        RETURN count(*) AS groups, coalesce(sum(c - 1), 0) AS rows
        """,
    )
    avg_relations = _run_scalar(
        session,
        """
        MATCH (e:__Entity__)
        OPTIONAL MATCH (e)-[r]-()
        WITH e, count(r) AS degree
        RETURN coalesce(avg(toFloat(degree)), 0.0) AS avg_degree
        """,
    ).get("avg_degree", 0.0)

    return {
        "entity_count": int(entity_count or 0),
        "relation_count": int(relation_count or 0),
        "duplicate_groups": int(duplicate_stats.get("groups", 0) or 0),
        "duplicate_rows": int(duplicate_stats.get("rows", 0) or 0),
        "avg_relations": float(avg_relations or 0.0),
    }


# ── Pipeline factory ──────────────────────────────────────────────────────────


def _build_pipeline(
    neo4j_uri: str,
    neo4j_user: str,
    neo4j_password: str,
    anthropic_api_key: str,
) -> tuple[Any, Any]:
    """Return (pipeline, sync_driver). Caller must close the driver."""
    import neo4j  # type: ignore[import-untyped]
    from neo4j_graphrag.experimental.pipeline.kg_builder import SimpleKGPipeline  # type: ignore[import-untyped]
    from neo4j_graphrag.llm import AnthropicLLM  # type: ignore[import-untyped]

    # SimpleKGPipeline requires a SYNC driver
    sync_driver = neo4j.GraphDatabase.driver(
        neo4j_uri, auth=(neo4j_user, neo4j_password)
    )

    llm = AnthropicLLM(
        model_name="claude-haiku-4-5-20251001",
        model_params={"temperature": 0, "max_tokens": 2048},
        api_key=anthropic_api_key,
    )

    embedder = _make_fastembed_embedder()

    pipeline = SimpleKGPipeline(
        llm=llm,
        driver=sync_driver,
        embedder=embedder,
        entities=_ENTITY_LABELS,  # plain strings ✓
        relations=_RELATION_LABELS,  # plain strings ✓
        potential_schema=_POTENTIAL_SCHEMA,
        from_pdf=False,
        on_error="IGNORE",
        perform_entity_resolution=True,
    )

    return pipeline, sync_driver


# ── Public API ────────────────────────────────────────────────────────────────


async def build_graph(
    chunks: list[Chunk],
    neo4j_uri: str,
    neo4j_user: str,
    neo4j_password: str,
    anthropic_api_key: str,
    source_name: str,
) -> GraphBuildStats:
    """Extract entities/relations from *chunks* and write to Neo4j."""
    stats = GraphBuildStats()
    pipeline, sync_driver = _build_pipeline(
        neo4j_uri, neo4j_user, neo4j_password, anthropic_api_key
    )

    try:
        for chunk in chunks:
            try:
                await pipeline.run_async(
                    text=chunk.text,
                    document_metadata={
                        "source": source_name,
                        "chunk_index": str(chunk.chunk_index),
                        "page": (
                            str(chunk.page_hint) if chunk.page_hint is not None else ""
                        ),
                    },
                )
                stats.chunks_processed += 1
                logger.info(
                    "Graph: chunk %d/%d done", chunk.chunk_index + 1, len(chunks)
                )
            except Exception as exc:
                msg = f"Chunk {chunk.chunk_index}: {exc}"
                logger.warning("Graph extraction error — %s", msg)
                stats.errors.append(msg)

        with sync_driver.session() as session:
            pre_cleanup = _collect_graph_stats(session)
            stats.entities_before_cleanup = pre_cleanup["entity_count"]

            merged_groups, merged_rows = _cleanup_duplicate_entities(session)
            stats.entities_merged = merged_rows
            stats.duplicate_entity_groups = max(
                pre_cleanup["duplicate_groups"], merged_groups
            )
            stats.duplicate_entity_rows = pre_cleanup["duplicate_rows"]

            stats.entities_pruned = _prune_low_degree_entities(
                session, _MIN_ENTITY_DEGREE
            )

            post_cleanup = _collect_graph_stats(session)
            stats.entities_after_cleanup = post_cleanup["entity_count"]
            stats.relation_count = post_cleanup["relation_count"]
            stats.avg_relations_per_entity = post_cleanup["avg_relations"]
            stats.entity_resolution_rate = (
                stats.entities_merged / stats.entities_before_cleanup
                if stats.entities_before_cleanup
                else 0.0
            )
    finally:
        sync_driver.close()

    logger.info(
        "Graph build complete: %d/%d chunks, %d errors",
        stats.chunks_processed,
        len(chunks),
        len(stats.errors),
    )
    logger.info(
        "Graph cleanup: entities %d -> %d, merged=%d pruned=%d, duplicate_rows=%d, avg_relations_per_entity=%.2f",
        stats.entities_before_cleanup,
        stats.entities_after_cleanup,
        stats.entities_merged,
        stats.entities_pruned,
        stats.duplicate_entity_rows,
        stats.avg_relations_per_entity,
    )
    return stats
