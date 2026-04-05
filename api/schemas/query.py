"""Request and response models for the POST /api/query endpoint."""

from __future__ import annotations

from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    session_id: str = Field(default="default", description="Conversation session identifier")
    tenant_id: str = Field(default="default", description="Data tenant scope")


class CitationOut(BaseModel):
    index: int
    source: str
    chunk_id: str | None = None
    score: float | None = None


class QueryResponse(BaseModel):
    question: str
    answer: str
    citations: list[CitationOut] = Field(default_factory=list)
    code_snippet: str | None = None
    faithfulness_score: float | None = None
    model_used: str
    retry_count: int
    latency_ms: float
