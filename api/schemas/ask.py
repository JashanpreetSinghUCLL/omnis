"""Request and response types for POST /v1/ask (SSE streaming endpoint).

SSE wire format
---------------
Each event is sent as:

    data: <JSON payload>\n\n

Event types (the `type` field in the JSON body)
-------------------------------------------------
tool_start   — a graph node has started executing
tool_result  — a graph node finished (includes partial state)
delta        — a token/word chunk from the final answer (simulated streaming)
citation     — one retrieved source after answer generation
cache_hit    — response served from cache; includes the cache layer (L1/L2/L3)
final        — stream terminator; includes the complete answer + metadata
error        — unrecoverable error during generation
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Inbound


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    session_id: str = Field(default="default")
    tenant_id: str = Field(default="default")
    model: str | None = Field(default=None, description="Force a specific model: claude-haiku-3-5 | claude-sonnet-4 | claude-opus-4")


# ── SSE event payloads


class ToolStartEvent(BaseModel):
    type: Literal["tool_start"] = "tool_start"
    node: str
    ts: float


class ToolResultEvent(BaseModel):
    type: Literal["tool_result"] = "tool_result"
    node: str
    data: dict[str, Any] = Field(default_factory=dict)
    ts: float


class DeltaEvent(BaseModel):
    type: Literal["delta"] = "delta"
    content: str
    node: str = "researcher"


class CitationEvent(BaseModel):
    type: Literal["citation"] = "citation"
    index: int
    source: str
    chunk_id: str | None = None
    score: float | None = None
    text: str | None = None


class CacheHitEvent(BaseModel):
    type: Literal["cache_hit"] = "cache_hit"
    layer: Literal["L1", "L2", "L3"]
    similarity: float | None = None  # None for L1 (exact match)


class FinalEvent(BaseModel):
    type: Literal["final"] = "final"
    answer: str
    model_used: str
    retry_count: int
    faithfulness_score: float | None = None
    latency_ms: float


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    detail: str


# Union type used by callers that need to accept any event
AskEvent = (
    ToolStartEvent
    | ToolResultEvent
    | DeltaEvent
    | CitationEvent
    | CacheHitEvent
    | FinalEvent
    | ErrorEvent
)
