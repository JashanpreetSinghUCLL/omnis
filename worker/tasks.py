"""Taskiq ingestion tasks.

Task lifecycle
--------------
1. API accepts file upload → enqueues `ingest_document_task`
2. Worker picks up task → runs the full ingestion pipeline
3. Each stage publishes progress to `ingest:progress:{job_id}` Redis channel
4. WebSocket subscribers (see api/routes/ingest.py) forward events to the client
5. On final failure (all retries exhausted) → dead-letter record pushed to DLQ_LIST

Retry strategy
--------------
SimpleRetryMiddleware retries up to 2 additional times (3 total attempts).
This task applies exponential back-off between retries using the `_retries`
label injected by the middleware: delay = 2^(_retries - 1) seconds.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import redis.asyncio as aioredis
from taskiq import Context, TaskiqDepends

from worker.broker import DLQ_LIST, _RESULT_URL, broker

logger = logging.getLogger(__name__)

_STAGES = ("parse", "chunk", "embed", "graph", "vector")


# ── Progress helpers


async def publish_progress(
    redis_client: aioredis.Redis,  # type: ignore[type-arg]
    job_id: str,
    stage: str,
    status: str,  # "running" | "done" | "error"
    detail: str = "",
    progress: float = 0.0,
    extra: dict[str, Any] | None = None,
) -> None:
    payload = json.dumps(
        {
            "job_id": job_id,
            "stage": stage,
            "status": status,
            "detail": detail,
            "progress": round(progress, 3),
            "ts": time.time(),
            **(extra or {}),
        }
    )
    try:
        await redis_client.publish(f"ingest:progress:{job_id}", payload)
    except Exception:
        logger.warning("Progress publish failed for job_id=%s stage=%s", job_id, stage)


# ── Ingestion task


@broker.task(task_name="ingest_document", retry_on_error=True)
async def ingest_document_task(
    file_path: str,
    tenant_id: str,
    job_id: str,
    original_filename: str = "",
    ctx: Context = TaskiqDepends(),
) -> dict[str, Any]:
    """Run the full ingestion pipeline for one document.

    Parameters
    ----------
    file_path:
        Absolute path to the saved upload (temp file managed by the API route).
    tenant_id:
        Tenant scope for multi-tenant isolation in Qdrant and Neo4j.
    job_id:
        UUID4 string used as pub/sub channel suffix and result key.
    ctx:
        Injected by Taskiq — provides access to message labels (_retries).
    """
    # ── Exponential back-off on retries
    retry_num: int = ctx.message.labels.get("_retries", 0)
    if retry_num > 0:
        delay = 2 ** (retry_num - 1)  # 1s, 2s on successive retries
        logger.info("Retry %d for job_id=%s — sleeping %ds", retry_num, job_id, delay)
        await asyncio.sleep(delay)

    redis_client: aioredis.Redis = aioredis.from_url(_RESULT_URL, decode_responses=True)  # type: ignore[type-arg]

    try:
        from api.config import get_settings
        from ingestion.pipeline import IngestionConfig, run_ingestion

        settings = get_settings()

        cfg = IngestionConfig(
            neo4j_uri=settings.neo4j_uri,
            neo4j_user=settings.neo4j_user,
            neo4j_password=settings.neo4j_password_str,
            qdrant_url=str(settings.qdrant_url),
            qdrant_api_key=(
                settings.qdrant_api_key.get_secret_value()
                if settings.qdrant_api_key
                else None
            ),
            redis_url=settings.redis_url,
            anthropic_api_key=settings.anthropic_api_key_str,
            voyage_api_key=(
                settings.voyage_api_key.get_secret_value()
                if settings.voyage_api_key
                else None
            ),
            llama_cloud_api_key=settings.llama_cloud_api_key_str,
            tenant_id=tenant_id,
        )

        t0 = time.perf_counter()

        # Publish stage-start events upfront so the client sees them immediately
        for i, stage in enumerate(_STAGES):
            await publish_progress(
                redis_client,
                job_id,
                stage,
                "pending",
                progress=i / len(_STAGES),
            )

        # ── Run the pipeline (each stage has idempotency gates inside) ────────
        # We wrap each stage in a coroutine so we can publish progress
        # around the synchronous pipeline call.
        await publish_progress(redis_client, job_id, "parse", "running", progress=0.0)
        result = await run_ingestion(file_path, cfg, source_name=original_filename or None)
        elapsed_ms = (time.perf_counter() - t0) * 1000

        # Publish per-stage timings after completion
        stage_map = {
            "parse": result.parse_s,
            "chunk": result.chunk_s,
            "embed": result.embed_s,
            "graph": result.graph_s,
            "vector": result.vector_s,
        }
        for i, (stage, duration) in enumerate(stage_map.items()):
            await publish_progress(
                redis_client,
                job_id,
                stage,
                "done",
                detail=f"{duration:.2f}s",
                progress=(i + 1) / len(_STAGES),
            )

        # Final completion event — embed counts so the client doesn't need
        # a separate REST call (avoids race with Taskiq storing the result).
        await publish_progress(
            redis_client,
            job_id,
            "complete",
            "done",
            detail=(
                f"Ingested {result.chunk_count} chunks "
                f"({result.vector_count} vectors) in {elapsed_ms:.0f}ms"
                + (" [SKIPPED — already processed]" if result.skipped else "")
            ),
            progress=1.0,
            extra={
                "page_count": result.page_count,
                "chunk_count": result.chunk_count,
                "entities_extracted": result.entities_extracted,
            },
        )

        logger.info(
            "Ingestion complete [job_id=%s elapsed_ms=%.1f skipped=%s chunks=%d]",
            job_id,
            elapsed_ms,
            result.skipped,
            result.chunk_count,
        )

        return {
            "job_id": job_id,
            "status": "complete",
            "skipped": result.skipped,
            "source": result.source,
            "content_hash": result.content_hash,
            "page_count": result.page_count,
            "chunk_count": result.chunk_count,
            "vector_count": result.vector_count,
            "entities_extracted": result.entities_extracted,
            "relations_extracted": result.relations_extracted,
            "elapsed_ms": round(elapsed_ms, 1),
            "errors": result.errors,
        }

    except Exception as exc:
        logger.exception(
            "Ingestion task failed [job_id=%s retry=%d]", job_id, retry_num
        )

        await publish_progress(
            redis_client,
            job_id,
            "failed",
            "error",
            detail=str(exc),
            progress=0.0,
        )

        # Push to dead-letter queue so failures can be inspected / replayed
        dlq_record = json.dumps(
            {
                "job_id": job_id,
                "file_path": file_path,
                "tenant_id": tenant_id,
                "retry": retry_num,
                "error": str(exc),
                "ts": time.time(),
            }
        )
        try:
            await redis_client.lpush(DLQ_LIST, dlq_record)
        except Exception:
            logger.warning("DLQ push failed for job_id=%s", job_id)

        raise  # Re-raise so Taskiq middleware can schedule retry

    finally:
        await redis_client.aclose()
