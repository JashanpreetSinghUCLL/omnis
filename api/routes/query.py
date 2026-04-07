"""POST /api/query — run the multi-agent graph against a user question."""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Awaitable, Callable
from functools import cache

from fastapi import APIRouter, HTTPException

from agents.graph import build_graph
from ingestion.embed_config import LOCAL_EMBED_MODEL
from agents.memory import GraphitiMemory
from agents.nodes import EmbedFn
from api.config import Settings, get_settings
from api.schemas.query import CitationOut, QueryRequest, QueryResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["query"])


# ── Query-embed factory (cached per process)


@cache
def _make_embed_fn(voyage_key: str | None) -> EmbedFn:
    """Return and cache an embed function for query vectors.

    Uses Voyage AI `voyage-query-lite-04` (same embedding space as ingestion
    with `voyage-large-4-04` — no re-indexing ever needed).
    Falls back to fastembed BGE-M3 if the Voyage key is absent.
    """
    if voyage_key:
        import voyageai  # type: ignore[import-untyped]

        _client = voyageai.AsyncClient(api_key=voyage_key)

        async def _voyage_embed(text: str) -> list[float]:
            result = await _client.embed([text], model="voyage-query-lite-04")
            vec: list[float] = result.embeddings[0]
            return vec

        logger.info("Query embedder: Voyage AI (voyage-query-lite-04)")
        return _voyage_embed
    else:
        import asyncio

        from fastembed import TextEmbedding  # type: ignore[import-untyped]

        _model = TextEmbedding(LOCAL_EMBED_MODEL)

        def _embed_sync(text: str) -> list[float]:
            vecs = list(_model.embed([text]))
            return vecs[0].tolist()

        async def _bge_embed(text: str) -> list[float]:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, _embed_sync, text)

        logger.info("Query embedder: fastembed %s (Voyage key absent)", LOCAL_EMBED_MODEL)
        return _bge_embed


def _graph_from_settings(
    settings: Settings,
    embed_fn: Callable[[str], Awaitable[list[float]]],
) -> object:
    return build_graph(
        anthropic_api_key=settings.anthropic_api_key_str,
        qdrant_url=str(settings.qdrant_url),
        qdrant_api_key=(
            settings.qdrant_api_key.get_secret_value()
            if settings.qdrant_api_key
            else None
        ),
        neo4j_uri=settings.neo4j_uri,
        neo4j_user=settings.neo4j_user,
        neo4j_password=settings.neo4j_password_str,
        cohere_api_key=settings.cohere_api_key_str,
        embed_fn=embed_fn,
    )


@cache
def _get_graph_memory() -> GraphitiMemory:
    """Create a process-wide Graphiti memory client.

    GraphitiMemory is non-fatal by design: if init fails, methods no-op.
    """
    settings = get_settings()
    if settings.openai_api_key_str and not os.getenv("OPENAI_API_KEY"):
        os.environ["OPENAI_API_KEY"] = settings.openai_api_key_str
    memory = GraphitiMemory(
        neo4j_uri=settings.neo4j_uri,
        neo4j_user=settings.neo4j_user,
        neo4j_password=settings.neo4j_password_str,
        anthropic_api_key=settings.anthropic_api_key_str,
    )
    return memory


# ── Endpoint


@router.post("/query", response_model=QueryResponse)
async def query_endpoint(req: QueryRequest) -> QueryResponse:
    """Run the multi-agent graph and return a cited, reviewed answer."""
    settings = get_settings()
    t0 = time.perf_counter()

    voyage_key = (
        settings.voyage_api_key.get_secret_value() if settings.voyage_api_key else None
    )

    try:
        embed_fn = _make_embed_fn(voyage_key)
        graph = _graph_from_settings(settings, embed_fn)
        memory = _get_graph_memory()
    except Exception as exc:
        logger.exception("Failed to initialise agent graph")
        raise HTTPException(
            status_code=500, detail=f"Agent init failed: {exc}"
        ) from exc

    prior_facts: list[str] = []
    try:
        await memory.build_indices()
        prior_facts = await memory.recall_context(
            tenant_id=req.tenant_id,
            question=req.question,
            num_results=5,
        )
    except Exception as exc:
        logger.warning("Graphiti recall skipped: %s", exc)

    initial_state = {
        "question": req.question,
        "session_id": req.session_id,
        "tenant_id": req.tenant_id,
        "force_model": None,
        "route": None,
        "model_used": "",
        "context": [],
        "citations": [],
        "memory_facts": prior_facts,
        "code_snippet": None,
        "final_answer": None,
        "errors": [],
        "faithfulness_score": None,
        "retry_count": 0,
    }

    try:
        final_state = await graph.ainvoke(initial_state)  # type: ignore[union-attr]
    except Exception as exc:
        logger.exception("Agent graph execution failed")
        raise HTTPException(
            status_code=500, detail=f"Agent execution failed: {exc}"
        ) from exc

    try:
        await memory.store_turn(
            session_id=req.session_id,
            tenant_id=req.tenant_id,
            question=req.question,
            answer=final_state.get("final_answer") or "",
            citations=final_state.get("citations", []),
        )
    except Exception as exc:
        logger.warning("Graphiti store skipped: %s", exc)

    latency = (time.perf_counter() - t0) * 1000
    return QueryResponse(
        question=req.question,
        answer=final_state.get("final_answer") or "No answer generated.",
        citations=[
            CitationOut(
                index=int(c.get("index", i + 1)),
                source=str(c.get("source", "")),
                chunk_id=str(c.get("chunk_id", "")) or None,
                score=float(c["score"]) if c.get("score") is not None else None,
            )
            for i, c in enumerate(final_state.get("citations", []))
        ],
        code_snippet=final_state.get("code_snippet"),
        faithfulness_score=final_state.get("faithfulness_score"),
        model_used=final_state.get("model_used") or "",
        retry_count=int(final_state.get("retry_count") or 0),
        latency_ms=round(latency, 1),
    )
