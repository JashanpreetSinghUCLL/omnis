"""Ingestion endpoints.

POST /v1/ingest
    Accepts a multipart file upload, saves to a temp file, enqueues the
    Taskiq `ingest_document_task`, and returns a `job_id` immediately.
    The caller does NOT wait for ingestion to complete.

GET  /v1/ingest/{job_id}
    Polls the Taskiq result backend for the task status.

WS   /v1/ingest/{job_id}/progress
    WebSocket that subscribes to the Redis pub/sub channel
    `ingest:progress:{job_id}` and forwards JSON progress events to the
    client until it receives a "complete" or "failed" stage.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
import uuid
from typing import Any

import neo4j
import redis.asyncio as aioredis
from fastapi import APIRouter, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from taskiq import TaskiqResult

from api.config import get_settings
from api.schemas.ingest import IngestResponse, JobStatusResponse
from worker.broker import _RESULT_URL, broker
from worker.tasks import ingest_document_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["ingest"])


async def _patch_source_name(content_hash: str, original_filename: str) -> None:
    """Rename the Neo4j + Redis source entry if it was stored under a temp name.

    Called when a file was already ingested (hash match) but may have been stored
    under an internal temp filename like ``omnis_ingest_abc123.pdf``.
    """
    settings = get_settings()
    redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        raw = await redis_client.get(f"ingest:done:{content_hash}")
        if not raw:
            return
        try:
            meta = json.loads(raw)
        except Exception:
            return
        old_source: str = meta.get("source", "")
        if not old_source or old_source == original_filename:
            return  # already correct

        logger.info(
            "Renaming source %r → %r in Neo4j [hash=%s]",
            old_source,
            original_filename,
            content_hash[:12],
        )
        driver = neo4j.AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password_str),
        )
        try:
            async with driver.session() as session:
                await session.run(
                    "MATCH (d:Document {source: $old}) SET d.source = $new",
                    old=old_source,
                    new=original_filename,
                )
        finally:
            await driver.close()

        # Update the Redis meta so future calls see the correct name
        meta["source"] = original_filename
        await redis_client.set(
            f"ingest:done:{content_hash}", json.dumps(meta), keepttl=True
        )
    except Exception:
        logger.exception(
            "Source rename failed [hash=%s old=%s new=%s]",
            content_hash[:12],
            "",
            original_filename,
        )
    finally:
        await redis_client.aclose()

_ALLOWED_EXTENSIONS: frozenset[str] = frozenset(
    {".pdf", ".txt", ".md", ".docx", ".html", ".htm"}
)
_MAX_FILE_SIZE_BYTES: int = 100 * 1024 * 1024  # 100 MB


# ── POST /v1/ingest


@router.post("/ingest", response_model=IngestResponse, status_code=202)
async def ingest_endpoint(
    file: UploadFile, tenant_id: str = "default"
) -> IngestResponse:
    """Accept a file upload, queue it for async ingestion.

    Returns HTTP 202 Accepted with a `job_id` immediately.
    Use the WebSocket endpoint to stream progress.
    """
    # ── Validate file
    filename = file.filename or "upload"
    _, ext = os.path.splitext(filename.lower())
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{ext}'. Allowed: {sorted(_ALLOWED_EXTENSIONS)}",
        )

    # ── Read and size-check
    content = await file.read()
    if len(content) > _MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(content) / 1024 / 1024:.1f} MB). Max 100 MB.",
        )

    # ── Dedup check: skip if this exact file content was already ingested ─────
    content_hash = hashlib.sha256(content).hexdigest()
    settings = get_settings()
    _dedup_redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        already_done = await _dedup_redis.exists(f"ingest:done:{content_hash}") == 1
    finally:
        await _dedup_redis.aclose()

    if already_done:
        logger.info(
            "Ingestion skipped — document already processed [hash=%s filename=%s]",
            content_hash[:12],
            filename,
        )
        # Fix the source name in Neo4j if it was stored under a temp filename.
        # Fire-and-forget — the response doesn't depend on this completing.
        import asyncio
        _rename_task = asyncio.ensure_future(_patch_source_name(content_hash, filename))
        _rename_task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)
        return IngestResponse(
            job_id=content_hash[:16],
            status="skipped",
            skipped=True,
            message="Document already ingested — no action taken.",
        )

    # ── Save to shared volume so the worker container can read it ────────────
    # /ingest_tmp is mounted in both api and worker via docker-compose.
    # Falls back to /tmp when running outside Docker (local dev).
    import pathlib
    _tmp_dir = pathlib.Path("/ingest_tmp") if pathlib.Path("/ingest_tmp").exists() else pathlib.Path(tempfile.gettempdir())
    _tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_suffix = ext if ext else ".bin"
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=tmp_suffix, prefix="omnis_ingest_", dir=str(_tmp_dir)
    ) as tmp:
        tmp.write(content)
        file_path = tmp.name

    job_id = uuid.uuid4().hex

    logger.info(
        "Ingestion queued [job_id=%s filename=%s size_kb=%.1f tenant=%s]",
        job_id,
        filename,
        len(content) / 1024,
        tenant_id,
    )

    # ── Ensure broker is started before kicking a task
    if not broker.is_worker_process:
        try:
            await broker.startup()
        except Exception:
            pass  # Already started

    # ── Enqueue the Taskiq task
    # Use our custom job_id as the Taskiq task ID so that
    # result_backend.get_result(job_id) in the polling endpoint works.
    try:
        await ingest_document_task.kicker().with_task_id(job_id).kiq(
            file_path=file_path,
            tenant_id=tenant_id,
            job_id=job_id,
            original_filename=filename,
        )
    except Exception as exc:
        # Clean up the temp file if we can't queue
        try:
            os.unlink(file_path)
        except OSError:
            pass
        logger.exception("Failed to enqueue ingestion task")
        raise HTTPException(
            status_code=500, detail=f"Failed to queue ingestion: {exc}"
        ) from exc

    return IngestResponse(job_id=job_id)


# ── GET /v1/ingest/{job_id}


@router.get("/ingest/{job_id}", response_model=JobStatusResponse)
async def job_status_endpoint(job_id: str) -> JobStatusResponse:
    """Poll the status of a queued ingestion job."""
    try:
        result_backend = broker.result_backend
        if result_backend is None:
            raise HTTPException(status_code=503, detail="Result backend unavailable")

        task_result: TaskiqResult | None = await result_backend.get_result(job_id)  # type: ignore[type-arg]

        if task_result is None:
            return JobStatusResponse(job_id=job_id, status="not_found")

        if task_result.is_err:
            return JobStatusResponse(
                job_id=job_id,
                status="failed",
                error=str(task_result.error),
            )

        result_data: Any = task_result.return_value
        status = (
            result_data.get("status", "complete")
            if isinstance(result_data, dict)
            else "complete"
        )
        return JobStatusResponse(
            job_id=job_id,
            status=status,
            result=result_data if isinstance(result_data, dict) else None,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Job status lookup failed [job_id=%s]", job_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── WS /v1/ingest/{job_id}/progress


@router.websocket("/ingest/{job_id}/progress")
async def ingest_progress_ws(websocket: WebSocket, job_id: str) -> None:
    """Subscribe to Redis pub/sub progress updates for an ingestion job.

    Closes automatically when the `complete` or `failed` stage is received,
    or when the client disconnects.
    """
    await websocket.accept()

    settings = get_settings()
    redis_client: aioredis.Redis = aioredis.from_url(  # type: ignore[type-arg]
        settings.redis_url, decode_responses=True
    )

    channel = f"ingest:progress:{job_id}"
    pubsub = redis_client.pubsub()

    try:
        await pubsub.subscribe(channel)
        logger.info("WS progress subscriber opened [job_id=%s]", job_id)

        async for raw_message in pubsub.listen():
            if raw_message["type"] != "message":
                continue

            try:
                event = json.loads(raw_message["data"])
            except (json.JSONDecodeError, TypeError):
                continue

            await websocket.send_json(event)

            # Terminate when the pipeline reaches a terminal state
            stage = event.get("stage", "")
            status = event.get("status", "")
            if stage in ("complete", "failed") and status in ("done", "error"):
                break

    except WebSocketDisconnect:
        logger.info("WS progress client disconnected [job_id=%s]", job_id)
    except Exception as exc:
        logger.exception("WS progress error [job_id=%s]: %s", job_id, exc)
        try:
            await websocket.send_json({"type": "error", "detail": str(exc)})
        except Exception:
            pass
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()
        except Exception:
            pass
        try:
            await redis_client.aclose()
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("WS progress subscriber closed [job_id=%s]", job_id)


# ── DELETE /v1/documents


@router.delete("/documents", status_code=200)
async def delete_document(source: str = Query()) -> dict:
    """Delete all data for a document identified by its filename (source).

    Removes:
      - All __Entity__ nodes reachable from this document's chunks (Neo4j)
      - All Chunk and Document nodes for this source (Neo4j)
      - All vectors tagged with this source (Qdrant)
      - The Redis dedup keys so the same file can be re-ingested cleanly
    """
    settings = get_settings()
    errors: list[str] = []

    # ── 1. Neo4j: delete entities, chunks, document nodes ─────────────────────
    try:
        driver = neo4j.AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password_str),
        )
        async with driver.session() as session:
            # Delete entities exclusively belonging to this document
            await session.run(
                """
                MATCH (e:__Entity__)-[:FROM_CHUNK]->(c:Chunk)-[:FROM_DOCUMENT]->(d:Document)
                WHERE d.source = $source
                WITH e, c, d
                // Only delete entity if ALL its chunks belong to this document
                WHERE NOT EXISTS {
                  MATCH (e)-[:FROM_CHUNK]->(other_chunk:Chunk)-[:FROM_DOCUMENT]->(other_doc:Document)
                  WHERE other_doc.source <> $source
                }
                DETACH DELETE e
                """,
                source=source,
            )
            # Delete chunks and document nodes for this source
            await session.run(
                """
                MATCH (c:Chunk)-[:FROM_DOCUMENT]->(d:Document)
                WHERE d.source = $source
                DETACH DELETE c, d
                """,
                source=source,
            )
        await driver.close()
        logger.info("Neo4j: deleted graph data for source=%s", source)
    except Exception as exc:
        logger.exception("Neo4j delete failed for source=%s", source)
        errors.append(f"neo4j: {exc}")

    # ── 2. Qdrant: delete vectors by source filter ─────────────────────────────
    try:
        from qdrant_client import AsyncQdrantClient  # type: ignore[import-untyped]
        from qdrant_client.models import FieldCondition, Filter, MatchValue  # type: ignore[import-untyped]

        qdrant = AsyncQdrantClient(
            url=str(settings.qdrant_url),
            api_key=settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None,
        )
        await qdrant.delete(
            collection_name="omnis_docs",
            points_selector=Filter(
                must=[FieldCondition(key="source", match=MatchValue(value=source))]
            ),
        )
        await qdrant.close()
        logger.info("Qdrant: deleted vectors for source=%s", source)
    except Exception as exc:
        logger.exception("Qdrant delete failed for source=%s", source)
        errors.append(f"qdrant: {exc}")

    # ── 3. Redis: clear dedup keys so the file can be re-ingested ─────────────
    try:
        redis_client: aioredis.Redis = aioredis.from_url(  # type: ignore[type-arg]
            settings.redis_url, decode_responses=True
        )
        # Find and delete all ingest:*:{hash} keys whose done-value has this source
        done_keys = await redis_client.keys("ingest:done:*")
        for key in done_keys:
            val = await redis_client.get(key)
            if val and source in val:
                content_hash = key.split(":")[-1]
                for stage in ("done", "embed", "graph", "vector"):
                    await redis_client.delete(f"ingest:{stage}:{content_hash}")
                logger.info("Redis: cleared dedup keys for source=%s hash=%s", source, content_hash[:12])
        await redis_client.aclose()
    except Exception as exc:
        logger.exception("Redis dedup clear failed for source=%s", source)
        errors.append(f"redis: {exc}")

    return {"deleted": source, "errors": errors}
