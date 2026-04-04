"""End-to-end ingestion pipeline.

parse → chunk → embed → graph → vector

Idempotency
-----------
Before processing, the pipeline checks Redis for a completion record keyed
by the document's SHA-256 content hash.  If the document was already
processed successfully, the run is skipped immediately.

Timing
------
Every stage is timed and the durations are logged at INFO level so you
can spot bottlenecks (parsing is usually the slowest for large PDFs;
graph extraction is the most expensive in API tokens).

Usage
-----
    from ingestion.pipeline import run_ingestion, IngestionConfig

    cfg = IngestionConfig(
        neo4j_uri="bolt://localhost:7687",
        neo4j_user="neo4j",
        neo4j_password="...",
        qdrant_url="http://localhost:6333",
        redis_url="redis://localhost:6379/0",
        anthropic_api_key="sk-ant-...",
        voyage_api_key="...",           # optional
        llama_cloud_api_key="...",      # optional
    )
    result = await run_ingestion(Path("my_doc.pdf"), cfg)
    print(result)
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_REDIS_TTL_S = 90 * 24 * 3600  # 90 days — processed-doc records


# ── Config ────────────────────────────────────────────────────────────────────


@dataclass
class IngestionConfig:
    # Databases
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "omnis_dev_password"
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str | None = None
    redis_url: str = "redis://:omnis_dev_redis@localhost:6379/0"

    # API keys
    anthropic_api_key: str = ""
    voyage_api_key: str | None = None
    llama_cloud_api_key: str | None = None

    # Ingestion settings
    collection_name: str = "omnis_docs"
    tenant_id: str = "default"
    chunk_size: int = 500
    chunk_overlap: int = 100


# ── Result ────────────────────────────────────────────────────────────────────


@dataclass
class IngestionResult:
    source: str
    content_hash: str
    skipped: bool = False  # True when document was already processed

    # Stage timings (seconds)
    parse_s: float = 0.0
    chunk_s: float = 0.0
    embed_s: float = 0.0
    graph_s: float = 0.0
    vector_s: float = 0.0

    # Counts
    page_count: int = 0
    chunk_count: int = 0
    vector_count: int = 0
    entities_extracted: int = 0
    relations_extracted: int = 0
    entities_resolved: int = 0

    errors: list[str] = field(default_factory=list)

    @property
    def total_s(self) -> float:
        return self.parse_s + self.chunk_s + self.embed_s + self.graph_s + self.vector_s

    def __str__(self) -> str:
        if self.skipped:
            return f"[SKIPPED] {self.source} (hash={self.content_hash[:12]}…)"
        return (
            f"[DONE] {self.source} | "
            f"pages={self.page_count} chunks={self.chunk_count} "
            f"vectors={self.vector_count} "
            f"entities={self.entities_extracted} relations={self.relations_extracted} "
            f"resolved={self.entities_resolved} | "
            f"parse={self.parse_s:.1f}s chunk={self.chunk_s:.1f}s "
            f"embed={self.embed_s:.1f}s graph={self.graph_s:.1f}s "
            f"vector={self.vector_s:.1f}s total={self.total_s:.1f}s"
        )


# ── Idempotency helpers (per-stage checkpoints) ───────────────────────────────


def _stage_key(content_hash: str, stage: str) -> str:
    return f"ingest:{stage}:{content_hash}"


async def _stage_done(redis: Any, content_hash: str, stage: str) -> bool:
    return await redis.exists(_stage_key(content_hash, stage)) == 1


async def _mark_stage(redis: Any, content_hash: str, stage: str) -> None:
    await redis.set(_stage_key(content_hash, stage), "1", ex=_REDIS_TTL_S)


async def _is_processed(redis: Any, content_hash: str) -> bool:
    """True only when ALL stages have completed."""
    for stage in ("embed", "graph", "vector"):
        if not await _stage_done(redis, content_hash, stage):
            return False
    return True


async def _mark_processed(redis: Any, content_hash: str, source: str) -> None:
    await redis.set(_stage_key(content_hash, "done"), source, ex=_REDIS_TTL_S)


# ── Client factories ──────────────────────────────────────────────────────────


def _make_redis(url: str) -> Any:
    import redis.asyncio as aioredis  # type: ignore[import-untyped]

    return aioredis.from_url(url, decode_responses=True)


def _make_qdrant(url: str, api_key: str | None) -> Any:
    from qdrant_client import AsyncQdrantClient  # type: ignore[import-untyped]

    return AsyncQdrantClient(url=url, api_key=api_key)


def _make_neo4j(uri: str, user: str, password: str) -> Any:
    import neo4j  # type: ignore[import-untyped]

    return neo4j.AsyncGraphDatabase.driver(uri, auth=(user, password))


# ── Stage timing context manager ──────────────────────────────────────────────


class _Timer:
    def __init__(self, label: str) -> None:
        self._label = label
        self._start = 0.0
        self.elapsed = 0.0

    def __enter__(self) -> "_Timer":
        self._start = time.perf_counter()
        return self

    def __exit__(self, *_: Any) -> None:
        self.elapsed = time.perf_counter() - self._start
        logger.info("Stage %-10s  %.2fs", self._label, self.elapsed)


# ── Main pipeline ─────────────────────────────────────────────────────────────


async def run_ingestion(
    pdf_path: str | Path,
    cfg: IngestionConfig,
) -> IngestionResult:
    """Run the full ingestion pipeline for a single PDF.

    Returns an :class:`IngestionResult` regardless of whether the document
    was already processed (check `result.skipped`).
    """
    from ingestion.chunker import chunk_document
    from ingestion.embedder import embed_chunks
    from ingestion.graph_builder import build_graph
    from ingestion.parser import parse_pdf
    from ingestion.vector_store import push_to_qdrant

    pdf_path = Path(pdf_path)
    source = pdf_path.name

    # ── Connect to backing stores ─────────────────────────────────────────────
    redis = _make_redis(cfg.redis_url)
    qdrant = _make_qdrant(cfg.qdrant_url, cfg.qdrant_api_key)
    neo4j_driver = _make_neo4j(cfg.neo4j_uri, cfg.neo4j_user, cfg.neo4j_password)

    # ── Stage 0: idempotency check (needs hash, so parse first minimally) ────
    # We need the hash before we can check — parse does the hashing.
    # For a pure hash-only check we'd need a pre-hash step; instead we
    # parse first (fast local I/O), then check.

    result = IngestionResult(source=source, content_hash="")

    try:
        # ── Stage 1: Parse ────────────────────────────────────────────────────
        with _Timer("parse") as t_parse:
            doc = await parse_pdf(pdf_path, llama_cloud_api_key=cfg.llama_cloud_api_key)
        result.parse_s = t_parse.elapsed
        result.content_hash = doc.content_hash
        result.page_count = doc.page_count

        logger.info(
            "Parsed %r — %d pages, hash=%s, parser=%s",
            source,
            doc.page_count,
            doc.content_hash[:12],
            doc.parser_used,
        )

        # ── Idempotency gate ──────────────────────────────────────────────────
        if await _is_processed(redis, doc.content_hash):
            logger.info("Document %r already processed — skipping", source)
            result.skipped = True
            return result

        # ── Stage 2: Chunk (always cheap, always run) ─────────────────────────
        with _Timer("chunk") as t_chunk:
            chunks = chunk_document(
                doc.content,
                chunk_size=cfg.chunk_size,
                chunk_overlap=cfg.chunk_overlap,
                source_hash=doc.content_hash,
            )
        result.chunk_s = t_chunk.elapsed
        result.chunk_count = len(chunks)
        logger.info("Chunked into %d chunks", len(chunks))

        # ── Stage 3: Embed ────────────────────────────────────────────────────
        if await _stage_done(redis, doc.content_hash, "embed"):
            logger.info("Stage embed   — already done, skipping")
            # Rebuild embedded list from cache (all hits, no API calls)
            embedded = await embed_chunks(chunks, redis=redis, voyage_api_key=None)
        else:
            with _Timer("embed") as t_embed:
                embedded = await embed_chunks(
                    chunks, redis=redis, voyage_api_key=cfg.voyage_api_key
                )
            result.embed_s = t_embed.elapsed
            await _mark_stage(redis, doc.content_hash, "embed")

        # ── Stage 4: Graph ────────────────────────────────────────────────────
        if await _stage_done(redis, doc.content_hash, "graph"):
            logger.info("Stage graph   — already done, skipping")
        else:
            with _Timer("graph") as t_graph:
                graph_stats = await build_graph(
                    chunks=chunks,
                    neo4j_uri=cfg.neo4j_uri,
                    neo4j_user=cfg.neo4j_user,
                    neo4j_password=cfg.neo4j_password,
                    anthropic_api_key=cfg.anthropic_api_key,
                    source_name=source,
                )
            result.graph_s = t_graph.elapsed
            result.errors.extend(graph_stats.errors)
            result.entities_extracted = graph_stats.entities_before_cleanup
            result.relations_extracted = graph_stats.relation_count
            result.entities_resolved = graph_stats.entities_merged
            await _mark_stage(redis, doc.content_hash, "graph")

        # ── Stage 5: Vector store ─────────────────────────────────────────────
        if await _stage_done(redis, doc.content_hash, "vector"):
            logger.info("Stage vector  — already done, skipping")
        else:
            with _Timer("vector") as t_vector:
                result.vector_count = await push_to_qdrant(
                    embedded_chunks=embedded,
                    qdrant_client=qdrant,
                    collection_name=cfg.collection_name,
                    tenant_id=cfg.tenant_id,
                    source=source,
                )
            result.vector_s = t_vector.elapsed
            await _mark_stage(redis, doc.content_hash, "vector")

        # ── Mark fully complete ───────────────────────────────────────────────
        await _mark_processed(redis, doc.content_hash, source)
        logger.info("%s", result)

    finally:
        # Always close connections
        await redis.aclose()
        await qdrant.close()
        await neo4j_driver.close()

    return result
