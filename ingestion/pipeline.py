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

Progress callbacks
------------------
Pass an optional ``progress_cb`` to receive stage lifecycle events, which
the CLI uses to drive a Rich live-panel display:

    def my_cb(stage: str, event: str, data: dict) -> None:
        # event: "start" | "done" | "skip" | "error"
        print(stage, event, data)

    result = await run_ingestion(path, cfg, progress_cb=my_cb)

Langfuse tracing
----------------
When the Langfuse SDK is available, a top-level trace is created for the
entire ingestion run and each stage becomes a child span.  Cost, latency,
and entity counts are recorded automatically.

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

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_REDIS_TTL_S = 90 * 24 * 3600  # 90 days — processed-doc records

# Stage callback: (stage_name, event, data) -> None
# event ∈ {"start", "done", "skip", "error"}
StageCallback = Callable[[str, str, dict[str, Any]], None]


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


async def _should_skip(
    redis: Any, content_hash: str, source: str, result: "IngestionResult"
) -> bool:
    """Return True and mutate *result* if this run should be skipped.

    Covers two cases:
    1. Already fully processed (``done`` key present in Redis).
    2. Currently being processed by another worker (``lock`` key present).
    """
    if await _is_processed(redis, content_hash):
        logger.info("Document %r already processed — skipping", source)
        meta = await _get_processed_meta(redis, content_hash)
        result.chunk_count = meta.get("chunk_count", 0)
        result.entities_extracted = meta.get("entity_count", 0)
        result.skipped = True
        return True

    lock_acquired = await redis.set(
        f"ingest:lock:{content_hash}", "1", nx=True, ex=7200
    )
    if not lock_acquired:
        logger.info(
            "Document %r is already being processed by another worker — skipping",
            source,
        )
        result.skipped = True
        return True

    return False


async def _is_processed(redis: Any, content_hash: str) -> bool:
    """True only when the full pipeline completed (``done`` key is set).

    Checking individual stage keys is insufficient because a crashed run can
    leave some stage keys set without ever reaching ``_mark_processed``.
    """
    return await redis.exists(_stage_key(content_hash, "done")) == 1


async def _mark_processed(
    redis: Any,
    content_hash: str,
    source: str,
    chunk_count: int = 0,
    entity_count: int = 0,
) -> None:
    import json as _json
    payload = _json.dumps(
        {"source": source, "chunk_count": chunk_count, "entity_count": entity_count}
    )
    await redis.set(_stage_key(content_hash, "done"), payload, ex=_REDIS_TTL_S)


async def _get_processed_meta(redis: Any, content_hash: str) -> dict[str, Any]:
    raw = await redis.get(_stage_key(content_hash, "done"))
    if not raw:
        return {}
    import json as _json
    try:
        return _json.loads(raw)  # type: ignore[no-any-return]
    except Exception:
        return {}


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

    def __enter__(self) -> _Timer:
        self._start = time.perf_counter()
        return self

    def __exit__(self, *_: Any) -> None:
        self.elapsed = time.perf_counter() - self._start
        logger.info("Stage %-10s  %.2fs", self._label, self.elapsed)


# ── Langfuse span helpers ─────────────────────────────────────────────────────


def _lf_start_span(trace: Any, name: str, input_data: dict[str, Any]) -> Any:
    """Create a Langfuse span if the trace object is not None."""
    if trace is None:
        return None
    try:
        return trace.span(name=name, input=input_data)
    except Exception:
        return None


def _lf_end_span(span: Any, output: dict[str, Any]) -> None:
    """End a Langfuse span with output data."""
    if span is None:
        return
    try:
        span.end(output=output)
    except Exception:
        pass


def _lf_create_trace(source: str, tenant_id: str) -> Any:
    """Create a Langfuse trace for an ingestion run; returns None on failure."""
    try:
        from observability.langfuse import get_langfuse_client

        lf = get_langfuse_client()
        return lf.trace(
            name="ingestion",
            input={"source": source, "tenant_id": tenant_id},
            tags=["ingestion"],
        )
    except Exception:
        return None


def _lf_flush() -> None:
    """Flush the Langfuse client (non-fatal)."""
    try:
        from observability.langfuse import get_langfuse_client

        get_langfuse_client().flush()
    except Exception:
        pass


async def _run_embed_stage(
    chunks: Any,
    redis: Any,
    content_hash: str,
    cfg: "IngestionConfig",
    lf_trace: Any,
    _cb: Any,
) -> tuple[Any, float]:
    """Run (or skip) the embed stage; returns (embedded_chunks, elapsed_s)."""
    from ingestion.embedder import embed_chunks

    if await _stage_done(redis, content_hash, "embed"):
        logger.info("Stage embed   — already done, skipping")
        _cb("embed", "skip", {})
        embedded = await embed_chunks(chunks, redis=redis, voyage_api_key=None)
        return embedded, 0.0

    _cb("embed", "start", {"chunk_count": len(chunks)})
    lf_span = _lf_start_span(lf_trace, "embed", {"chunks": len(chunks)})
    with _Timer("embed") as t_embed:
        embedded = await embed_chunks(chunks, redis=redis, voyage_api_key=cfg.voyage_api_key)
    _lf_end_span(
        lf_span,
        {"embedded_count": len(embedded), "elapsed_s": round(t_embed.elapsed, 2)},
    )
    _cb("embed", "done", {"count": len(embedded), "elapsed_s": round(t_embed.elapsed, 2)})
    await _mark_stage(redis, content_hash, "embed")
    return embedded, t_embed.elapsed


# ── Main pipeline ─────────────────────────────────────────────────────────────


async def run_ingestion(
    pdf_path: str | Path,
    cfg: IngestionConfig,
    progress_cb: StageCallback | None = None,
    source_name: str | None = None,
) -> IngestionResult:
    """Run the full ingestion pipeline for a single PDF.

    Returns an :class:`IngestionResult` regardless of whether the document
    was already processed (check `result.skipped`).

    Args:
        pdf_path: Path to the PDF file.
        cfg: Ingestion configuration (database URLs, API keys, etc.).
        progress_cb: Optional callback invoked at each stage lifecycle event.
            Signature: ``(stage: str, event: str, data: dict) -> None``
            where event ∈ ``{"start", "done", "skip", "error"}``.
    """
    from ingestion.chunker import chunk_document
    from ingestion.graph_builder import build_graph
    from ingestion.parser import parse_pdf
    from ingestion.vector_store import push_to_qdrant

    pdf_path = Path(pdf_path)
    source = source_name or pdf_path.name

    def _cb(stage: str, event: str, data: dict[str, Any] | None = None) -> None:
        if progress_cb is not None:
            progress_cb(stage, event, data or {})

    # ── Connect to backing stores ─────────────────────────────────────────────
    redis = _make_redis(cfg.redis_url)
    qdrant = _make_qdrant(cfg.qdrant_url, cfg.qdrant_api_key)
    neo4j_driver = _make_neo4j(cfg.neo4j_uri, cfg.neo4j_user, cfg.neo4j_password)

    result = IngestionResult(source=source, content_hash="")

    # Start a Langfuse trace for the whole ingestion run
    lf_trace = _lf_create_trace(source, cfg.tenant_id)

    try:
        # ── Stage 1: Parse ────────────────────────────────────────────────────
        _cb("parse", "start", {"file": source, "bytes": pdf_path.stat().st_size})
        lf_span = _lf_start_span(lf_trace, "parse", {"file": source})
        with _Timer("parse") as t_parse:
            doc = await parse_pdf(pdf_path, llama_cloud_api_key=cfg.llama_cloud_api_key)
        result.parse_s = t_parse.elapsed
        result.content_hash = doc.content_hash
        result.page_count = doc.page_count
        _lf_end_span(lf_span, {"pages": doc.page_count, "parser": doc.parser_used})
        _cb(
            "parse",
            "done",
            {
                "pages": doc.page_count,
                "hash": doc.content_hash[:12],
                "parser": doc.parser_used,
                "elapsed_s": round(t_parse.elapsed, 2),
            },
        )

        logger.info(
            "Parsed %r — %d pages, hash=%s, parser=%s",
            source,
            doc.page_count,
            doc.content_hash[:12],
            doc.parser_used,
        )

        # ── Idempotency + distributed lock ───────────────────────────────────
        if await _should_skip(redis, doc.content_hash, source, result):
            _cb("*", "skip", {"hash": doc.content_hash[:12]})
            return result

        # ── Stage 2: Chunk (always cheap, always run) ─────────────────────────
        _cb("chunk", "start", {})
        lf_span = _lf_start_span(lf_trace, "chunk", {"chunk_size": cfg.chunk_size})
        with _Timer("chunk") as t_chunk:
            chunks = chunk_document(
                doc.content,
                chunk_size=cfg.chunk_size,
                chunk_overlap=cfg.chunk_overlap,
                source_hash=doc.content_hash,
            )
        result.chunk_s = t_chunk.elapsed
        result.chunk_count = len(chunks)
        _lf_end_span(lf_span, {"chunk_count": len(chunks)})
        _cb("chunk", "done", {"count": len(chunks), "elapsed_s": round(t_chunk.elapsed, 2)})
        logger.info("Chunked into %d chunks", len(chunks))

        # ── Stage 3: Embed ────────────────────────────────────────────────────
        embedded, result.embed_s = await _run_embed_stage(
            chunks, redis, doc.content_hash, cfg, lf_trace, _cb
        )

        # ── Stage 4: Graph ────────────────────────────────────────────────────
        if await _stage_done(redis, doc.content_hash, "graph"):
            logger.info("Stage graph   — already done, skipping")
            _cb("graph", "skip", {})
        else:
            _cb("graph", "start", {"chunk_count": len(chunks)})
            lf_span = _lf_start_span(lf_trace, "graph_extraction", {"chunks": len(chunks)})
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
            _lf_end_span(
                lf_span,
                {
                    "entities": graph_stats.entities_before_cleanup,
                    "relations": graph_stats.relation_count,
                    "merged": graph_stats.entities_merged,
                    "elapsed_s": round(t_graph.elapsed, 2),
                },
            )
            _cb(
                "graph",
                "done",
                {
                    "entities": result.entities_extracted,
                    "relations": result.relations_extracted,
                    "resolved": result.entities_resolved,
                    "elapsed_s": round(t_graph.elapsed, 2),
                },
            )
            await _mark_stage(redis, doc.content_hash, "graph")

        # ── Stage 5: Vector store ─────────────────────────────────────────────
        if await _stage_done(redis, doc.content_hash, "vector"):
            logger.info("Stage vector  — already done, skipping")
            _cb("vector", "skip", {})
        else:
            _cb("vector", "start", {"embedded_count": len(embedded)})
            lf_span = _lf_start_span(lf_trace, "vector_store", {"vectors": len(embedded)})
            with _Timer("vector") as t_vector:
                result.vector_count = await push_to_qdrant(
                    embedded_chunks=embedded,
                    qdrant_client=qdrant,
                    collection_name=cfg.collection_name,
                    tenant_id=cfg.tenant_id,
                    source=source,
                )
            result.vector_s = t_vector.elapsed
            _lf_end_span(
                lf_span,
                {
                    "vectors_written": result.vector_count,
                    "elapsed_s": round(t_vector.elapsed, 2),
                },
            )
            _cb(
                "vector",
                "done",
                {"count": result.vector_count, "elapsed_s": round(t_vector.elapsed, 2)},
            )
            await _mark_stage(redis, doc.content_hash, "vector")

        # ── Mark fully complete ───────────────────────────────────────────────
        await _mark_processed(
            redis,
            doc.content_hash,
            source,
            chunk_count=result.chunk_count,
            entity_count=result.entities_extracted,
        )
        logger.info("%s", result)

        # Finalise the Langfuse trace with summary metrics
        if lf_trace is not None:
            try:
                lf_trace.update(
                    output={
                        "pages": result.page_count,
                        "chunks": result.chunk_count,
                        "vectors": result.vector_count,
                        "entities": result.entities_extracted,
                        "total_s": round(result.total_s, 2),
                    }
                )
            except Exception:
                pass

    finally:
        # Release the processing lock (if we acquired it)
        if result.content_hash:
            try:
                await redis.delete(f"ingest:lock:{result.content_hash}")
            except Exception:
                pass
        # Always close connections
        await redis.aclose()
        await qdrant.close()
        await neo4j_driver.close()
        _lf_flush()

    return result
