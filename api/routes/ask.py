"""POST /v1/ask — SSE streaming endpoint.

Stream of typed JSON events separated by double-newlines:

    data: {"type": "tool_start", "node": "classifier", "ts": 1234}\n\n
    data: {"type": "tool_result", "node": "classifier", "data": {...}, "ts": 1234}\n\n
    ...
    data: {"type": "delta", "content": "Hello ", "node": "researcher"}\n\n
    data: {"type": "citation", "index": 1, "source": "doc.pdf", ...}\n\n
    data: {"type": "final", "answer": "...", "latency_ms": 1234}\n\n

Cache behaviour
---------------
* L1/L2 cache hit → emits `cache_hit` then `final` instantly.
* Cache miss → full graph execution with per-node events, then stores result.

Headers
-------
    Cache-Control: no-cache
    X-Accel-Buffering: no          (disables nginx proxy buffering)
    X-Cache: HIT-L1 | HIT-L2 | MISS
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import AsyncIterator
from functools import cache

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from agents.graph import build_graph
from agents.memory import GraphitiMemory
from agents.nodes import EmbedFn
from api.config import Settings, get_settings
from ingestion.embed_config import LOCAL_EMBED_MODEL
from api.middleware.cache import ResponseCache
from api.schemas.ask import (
    AskRequest,
    CitationEvent,
    DeltaEvent,
    ErrorEvent,
    FinalEvent,
    ToolResultEvent,
    ToolStartEvent,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["ask"])

# Nodes whose start/end we surface as SSE events
_TRACKED_NODES: frozenset[str] = frozenset(
    {"classifier", "researcher", "coder", "reviewer", "degradation"}
)


# ── Process-level singletons


@cache
def _make_embed_fn(voyage_key: str | None) -> EmbedFn:
    """Cached per-process embed function (shared with query.py logic)."""
    if voyage_key:
        import voyageai  # type: ignore[import-untyped]

        _client = voyageai.AsyncClient(api_key=voyage_key)

        async def _voyage(text: str) -> list[float]:
            result = await _client.embed([text], model="voyage-query-lite-04")
            vec: list[float] = result.embeddings[0]
            return vec

        return _voyage
    else:
        import asyncio as _asyncio

        from fastembed import TextEmbedding  # type: ignore[import-untyped]

        _model = TextEmbedding(LOCAL_EMBED_MODEL)

        async def _bge(text: str) -> list[float]:
            loop = _asyncio.get_running_loop()
            vecs = await loop.run_in_executor(None, lambda: list(_model.embed([text])))
            return vecs[0].tolist()

        return _bge


@cache
def _get_graph(settings_id: int, embed_fn: EmbedFn) -> object:  # type: ignore[return]
    """One compiled graph per process; keyed by settings identity.

    `settings_id` is `id(get_settings())` — an int, so hashable.
    Settings is NOT passed as a cache arg to avoid the unhashable-BaseModel issue.
    """
    settings = get_settings()
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
def _get_memory() -> GraphitiMemory:
    settings = get_settings()
    if settings.openai_api_key_str and not os.getenv("OPENAI_API_KEY"):
        os.environ["OPENAI_API_KEY"] = settings.openai_api_key_str
    return GraphitiMemory(
        neo4j_uri=settings.neo4j_uri,
        neo4j_user=settings.neo4j_user,
        neo4j_password=settings.neo4j_password_str,
        anthropic_api_key=settings.anthropic_api_key_str,
    )


@cache
def _get_cache(settings_id: int, embed_fn: EmbedFn) -> ResponseCache:
    """Keyed by settings identity; Settings object not passed to avoid hashability issues."""
    settings = get_settings()
    return ResponseCache(
        redis_url=settings.redis_url,
        qdrant_url=str(settings.qdrant_url),
        qdrant_api_key=(
            settings.qdrant_api_key.get_secret_value()
            if settings.qdrant_api_key
            else None
        ),
        embed_fn=embed_fn,
        l1_ttl_s=settings.cache_l1_ttl_s,
        l2_ttl_s=settings.cache_l2_ttl_s,
        l2_threshold=settings.cache_l2_threshold,
    )


# ── SSE helpers


def _sse(payload: object) -> str:
    """Serialise a Pydantic model or dict as an SSE data frame."""
    if hasattr(payload, "model_dump"):
        body = payload.model_dump()  # type: ignore[union-attr]
    else:
        body = payload
    return f"data: {json.dumps(body)}\n\n"


async def _simulate_delta(answer: str, node: str = "researcher") -> AsyncIterator[str]:
    """Yield answer word-by-word to simulate streaming tokens.

    The existing agent nodes use non-streaming LLM calls.  Until nodes are
    refactored to use streaming ChatAnthropic, we emit the full answer chunked
    into ~5-word bursts with a small delay so the client perceives streaming.
    """
    words = answer.split()
    chunk_size = 5
    for i in range(0, len(words), chunk_size):
        chunk = " ".join(words[i : i + chunk_size])
        if i + chunk_size < len(words):
            chunk += " "
        yield _sse(DeltaEvent(content=chunk, node=node))
        await asyncio.sleep(0.02)


# ── _generate helpers (extracted to keep cognitive complexity within bounds) ──


def _node_summary(node_name: str, node_output: dict) -> dict:  # type: ignore[type-arg]
    """Return a compact SSE summary dict for a node's output."""
    latency = node_output.get("latency_ms")
    base: dict = {"latency_ms": latency} if latency is not None else {}  # type: ignore[type-arg]
    if node_name == "classifier":
        return {**base, "route": node_output.get("route"), "model_used": node_output.get("model_used")}
    if node_name == "researcher":
        return {
            **base,
            "chunk_count": len(node_output.get("context", [])),
            "citation_count": len(node_output.get("citations", [])),
        }
    if node_name == "reviewer":
        return {
            **base,
            "faithfulness_score": node_output.get("faithfulness_score"),
            "retry_count": node_output.get("retry_count"),
        }
    if node_name == "coder":
        return {**base, "has_code": bool(node_output.get("code_snippet"))}
    return base


async def _recall_prior_facts(memory: object, req: AskRequest) -> list[str]:
    """Return Graphiti prior-turn facts; returns [] on any failure."""
    try:
        from agents.memory import GraphitiMemory  # already imported at module level

        assert isinstance(memory, GraphitiMemory)
        await memory.build_indices()
        return await memory.recall_context(  # type: ignore[return-value]
            tenant_id=req.tenant_id,
            question=req.question,
            num_results=5,
        )
    except Exception as exc:
        logger.warning("Graphiti recall skipped: %s", exc)
        return []


async def _yield_cache_hit(
    cache_result: tuple,  # type: ignore[type-arg]
    t0: float,
) -> AsyncIterator[str]:
    """Yield SSE events for a cache hit (cache_hit → delta → citation → final)."""
    layer, cached, similarity = cache_result
    yield _sse({"type": "cache_hit", "layer": layer, "similarity": similarity})
    async for delta in _simulate_delta(cached.get("answer", ""), "researcher"):
        yield delta
    for i, cit in enumerate(cached.get("citations", [])):
        yield _sse(
            CitationEvent(
                index=cit.get("index", i + 1),
                source=cit.get("source", ""),
                chunk_id=cit.get("chunk_id"),
                score=cit.get("score"),
                text=cit.get("text"),
            )
        )
    yield _sse(
        FinalEvent(
            answer=cached.get("answer", ""),
            model_used=cached.get("model_used", ""),
            retry_count=cached.get("retry_count", 0),
            faithfulness_score=cached.get("faithfulness_score"),
            latency_ms=round((time.perf_counter() - t0) * 1000, 1),
        )
    )


async def _yield_graph_events(
    graph: object,
    initial_state: dict,  # type: ignore[type-arg]
) -> AsyncIterator[tuple[str, dict]]:  # type: ignore[type-arg]
    """Stream node outputs from the compiled LangGraph; yields (node_name, node_output)."""
    async for chunk in graph.astream(initial_state):  # type: ignore[union-attr]
        for node_name, node_output in chunk.items():
            if node_name in _TRACKED_NODES:
                yield node_name, node_output


async def _store_result(
    memory: object,
    response_cache: object,
    req: AskRequest,
    answer: str,
    citations: list[dict],  # type: ignore[type-arg]
    final_state: dict,  # type: ignore[type-arg]
    embed_fn: EmbedFn,
) -> None:
    """Persist turn in Graphiti memory and response in cache (both non-fatal)."""
    try:
        from agents.memory import GraphitiMemory

        assert isinstance(memory, GraphitiMemory)
        await memory.store_turn(
            session_id=req.session_id,
            tenant_id=req.tenant_id,
            question=req.question,
            answer=answer,
            citations=citations,
        )
    except Exception as exc:
        logger.warning("Graphiti store skipped: %s", exc)

    cache_payload: dict = {  # type: ignore[type-arg]
        "answer": answer,
        "citations": citations,
        "model_used": final_state.get("model_used") or "",
        "retry_count": int(final_state.get("retry_count") or 0),
        "faithfulness_score": final_state.get("faithfulness_score"),
    }
    try:
        from api.middleware.cache import ResponseCache

        assert isinstance(response_cache, ResponseCache)
        embedding: list[float] | None = await response_cache._emb_get(req.question)
        if embedding is None:
            embedding = await embed_fn(req.question)
        await response_cache.set(req.question, req.tenant_id, cache_payload, embedding)
    except Exception as exc:
        logger.warning("Cache store skipped: %s", exc)


def _lf_start_query_trace(req: AskRequest) -> object:
    """Create a Langfuse trace for one query; returns None if Langfuse unavailable."""
    try:
        from observability.langfuse import get_langfuse_client

        lf = get_langfuse_client()
        return lf.trace(
            name="agent-query",
            session_id=req.session_id,
            user_id=req.tenant_id,
            input={"question": req.question},
            tags=["ask"],
        )
    except Exception:
        return None


def _lf_end_query_trace(trace: object, final_state: dict, latency_ms: float) -> None:  # type: ignore[type-arg]
    """Update the Langfuse trace with final metrics."""
    if trace is None:
        return
    try:
        trace.update(  # type: ignore[union-attr]
            output={"answer_preview": str(final_state.get("final_answer") or "")[:200]},
            metadata={
                "latency_ms": latency_ms,
                "faithfulness_score": final_state.get("faithfulness_score"),
                "model_used": final_state.get("model_used"),
                "retry_count": final_state.get("retry_count"),
                "citation_count": len(final_state.get("citations", [])),
            },
        )
        from observability.langfuse import get_langfuse_client

        get_langfuse_client().flush()
    except Exception:
        pass


# ── Stream generator


async def _generate(
    req: AskRequest,
    settings: Settings,
    embed_fn: EmbedFn,
) -> AsyncIterator[str]:
    """Core async generator: checks cache → runs graph → yields SSE events."""
    t0 = time.perf_counter()
    lf_trace = _lf_start_query_trace(req)

    # ── Cache lookup
    response_cache = _get_cache(id(settings), embed_fn)
    cache_result = await response_cache.get(req.question, req.tenant_id)

    if cache_result is not None:
        async for event in _yield_cache_hit(cache_result, t0):
            yield event
        return

    # ── Cache miss — run graph
    graph = _get_graph(id(settings), embed_fn)
    memory = _get_memory()
    prior_facts = await _recall_prior_facts(memory, req)

    initial_state = {
        "question": req.question,
        "session_id": req.session_id,
        "tenant_id": req.tenant_id,
        "force_model": req.model,
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
        "latency_ms": None,
    }

    final_state: dict = {}  # type: ignore[type-arg]
    try:
        async for node_name, node_output in _yield_graph_events(graph, initial_state):
            ts = time.time()
            yield _sse(ToolStartEvent(node=node_name, ts=ts))
            yield _sse(
                ToolResultEvent(
                    node=node_name,
                    data=_node_summary(node_name, node_output),
                    ts=time.time(),
                )
            )
            final_state.update(node_output)
    except Exception as exc:
        logger.exception("Graph streaming failed")
        yield _sse(ErrorEvent(detail=f"Graph execution failed: {exc}"))
        return

    # ── Emit answer tokens
    answer: str = final_state.get("final_answer") or "No answer generated."
    async for delta in _simulate_delta(answer):
        yield delta

    # ── Emit citations
    citations: list[dict] = final_state.get("citations", [])  # type: ignore[type-arg]
    for i, cit in enumerate(citations):
        yield _sse(
            CitationEvent(
                index=int(cit.get("index", i + 1)),
                source=str(cit.get("source", "")),
                chunk_id=str(cit.get("chunk_id", "")) or None,
                score=float(cit["score"]) if cit.get("score") is not None else None,
                text=str(cit.get("text", "")) or None,
            )
        )

    # ── Final event
    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    yield _sse(
        FinalEvent(
            answer=answer,
            model_used=final_state.get("model_used") or "",
            retry_count=int(final_state.get("retry_count") or 0),
            faithfulness_score=final_state.get("faithfulness_score"),
            latency_ms=latency_ms,
        )
    )

    # ── Persist + trace (non-fatal)
    await _store_result(memory, response_cache, req, answer, citations, final_state, embed_fn)
    _lf_end_query_trace(lf_trace, final_state, latency_ms)


# ── Endpoint


@router.post("/ask")
async def ask_endpoint(req: AskRequest, request: Request) -> StreamingResponse:
    """SSE streaming multi-agent answer endpoint.

    Emits: tool_start · tool_result · delta · citation · final
    (or cache_hit · delta · citation · final on cache hit)
    """
    settings = get_settings()
    voyage_key = (
        settings.voyage_api_key.get_secret_value() if settings.voyage_api_key else None
    )
    embed_fn = _make_embed_fn(voyage_key)

    # Determine cache header (will be overwritten mid-stream if we hit cache,
    # but the header is set before the body — we optimistically set MISS)
    extra_headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "X-Cache": "MISS",
    }

    async def _stream() -> AsyncIterator[bytes]:
        cache_layer: str | None = None
        async for chunk in _generate(req, settings, embed_fn):
            # Detect if first event is a cache_hit so we can log it
            if cache_layer is None and '"cache_hit"' in chunk:
                try:
                    evt = json.loads(chunk.removeprefix("data: ").strip())
                    cache_layer = evt.get("layer", "L?")
                    logger.info("Serving from cache layer %s", cache_layer)
                except Exception:
                    pass
            yield chunk.encode("utf-8")

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers=extra_headers,
    )
