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

import json
import logging
import os
import tempfile
import uuid
from typing import Any

import redis.asyncio as aioredis
from fastapi import APIRouter, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from taskiq import TaskiqResult

from api.config import get_settings
from api.schemas.ingest import IngestResponse, JobStatusResponse
from worker.broker import _RESULT_URL, broker
from worker.tasks import ingest_document_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["ingest"])

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

    # ── Save to a named temp file (worker will clean up after processing) ─────
    tmp_suffix = ext if ext else ".bin"
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=tmp_suffix, prefix="omnis_ingest_"
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
    try:
        await ingest_document_task.kiq(
            file_path=file_path,
            tenant_id=tenant_id,
            job_id=job_id,
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
