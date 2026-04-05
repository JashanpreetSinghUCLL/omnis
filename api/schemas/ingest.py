"""Request and response schemas for the ingestion endpoints.

POST /v1/ingest     — accepts multipart file upload, returns job_id immediately
GET  /v1/ingest/{job_id}  — polls task status
WS   /v1/ingest/{job_id}/progress — streams stage updates from Redis pub/sub
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class IngestResponse(BaseModel):
    job_id: str = Field(..., description="UUID4 task identifier")
    status: Literal["queued"] = "queued"
    message: str = "Document queued for ingestion"


class JobStatusResponse(BaseModel):
    job_id: str
    status: Literal["pending", "running", "complete", "failed", "not_found"]
    result: dict[str, Any] | None = None
    error: str | None = None


class ProgressEvent(BaseModel):
    """Wire format for WebSocket progress messages."""

    job_id: str
    stage: str
    status: str  # "pending" | "running" | "done" | "error"
    detail: str = ""
    progress: float = 0.0
    ts: float
