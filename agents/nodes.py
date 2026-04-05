"""Agent node implementations for the LangGraph graph.

Each public symbol is a *factory* that closes over stateful dependencies
(LLM client key, retriever) and returns a plain async node callable with the
signature expected by StateGraph:

    async (state: AgentState) -> dict[str, Any]

The returned dict is a *partial* update — only keys that change are returned.
LangGraph merges it into the running state automatically.

Node execution order
--------------------
classifier → researcher → [coder] → reviewer
                              ↑___________|  (retry loop, max 3)
                          degradation (on retry ceiling)
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Awaitable, Callable
from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage

from agents.router import HAIKU, SONNET, ModelRoute, route_question
from agents.state import MAX_RETRIES, AgentState
from retrieval.pipeline import HybridRetriever

logger = logging.getLogger(__name__)

FAITHFULNESS_THRESHOLD: float = 0.85

# ── Type alias

EmbedFn = Callable[[str], Awaitable[list[float]]]

# ── Internal helpers


def _llm(model_id: str, api_key: str) -> ChatAnthropic:
    """Construct a ChatAnthropic client with runtime model resolution.

    The routing uses logical model labels. This resolver allows mapping
    those labels to actually deployed Anthropic model IDs via env vars so the
    graph remains runnable across different accounts/regions.
    """
    resolved_model_id = {
        "claude-haiku-3-5": os.getenv(
            "ROUTER_RUNTIME_HAIKU_MODEL", "claude-haiku-4-5-20251001"
        ),
        "claude-sonnet-4": os.getenv(
            "ROUTER_RUNTIME_SONNET_MODEL", "claude-sonnet-4-6"
        ),
        "claude-opus-4": os.getenv("ROUTER_RUNTIME_OPUS_MODEL", "claude-opus-4-6"),
    }.get(model_id, model_id)

    if resolved_model_id != model_id:
        logger.info(
            "Model resolve | requested=%s runtime=%s", model_id, resolved_model_id
        )

    return ChatAnthropic(  # type: ignore[call-arg]
        model=resolved_model_id,
        api_key=api_key,
        max_tokens=2048,
        temperature=0,
    )


def _context_text(context: list[dict[str, Any]]) -> str:
    """Flatten context chunks into a numbered block for prompt injection."""
    if not context:
        return "No context available."
    parts: list[str] = []
    for i, chunk in enumerate(context, 1):
        text = str(chunk.get("text", ""))
        source = chunk.get("source", "unknown")
        parts.append(f"[{i}] (source: {source})\n{text}")
    return "\n\n".join(parts)


def _preview(text: str, limit: int = 240) -> str:
    """Return a single-line preview for structured debug logs."""
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit]}..."


# ── Node 1: Classifier


def make_classifier_node() -> Callable[[AgentState], Awaitable[dict[str, Any]]]:
    """Return classifier_node — routes the question to 'researcher' or 'coder'."""

    async def classifier_node(state: AgentState) -> dict[str, Any]:
        decision: ModelRoute = route_question(state["question"])
        return {"route": decision.route, "model_used": decision.model_id}

    return classifier_node


# ── Node 2: Researcher

_RESEARCHER_SYSTEM = (
    "You are a precise knowledge retrieval assistant. "
    "Answer the question using ONLY the provided context. "
    "Cite sources by their [n] index number. "
    "If the context is insufficient, say so explicitly — do not hallucinate."
)


def make_researcher_node(
    retriever: HybridRetriever,
    embed_fn: EmbedFn,
    api_key: str,
) -> Callable[[AgentState], Awaitable[dict[str, Any]]]:
    """Return researcher_node — retrieves context and generates a grounded answer."""

    async def researcher_node(state: AgentState) -> dict[str, Any]:
        t0 = time.perf_counter()
        question = state["question"]
        memory_facts = state.get("memory_facts", [])

        # ── Embed query
        query_vector = await embed_fn(question)

        # ── Hybrid retrieval
        result = await retriever.retrieve(
            query_text=question,
            query_vector=query_vector,
            tenant_id=state["tenant_id"],
        )

        context: list[dict[str, Any]] = [
            {
                "text": r.fused.text,
                "score": r.rerank_score,
                "source": r.fused.source,
                "chunk_id": r.fused.id,
            }
            for r in result.ranked
        ]
        citations: list[dict[str, Any]] = [
            {
                "index": i + 1,
                "source": c["source"],
                "chunk_id": c["chunk_id"],
                "score": c["score"],
            }
            for i, c in enumerate(context)
        ]

        # ── Generate grounded answer
        model_id = state.get("model_used") or HAIKU
        llm = _llm(model_id, api_key)
        ctx_text = _context_text(context)
        memory_text = "\n".join(f"- {fact}" for fact in memory_facts[:8])
        if not memory_text:
            memory_text = "No relevant prior-turn memory."
        response = await llm.ainvoke(
            [
                SystemMessage(content=_RESEARCHER_SYSTEM),
                HumanMessage(
                    content=(
                        f"Context:\n{ctx_text}\n\n"
                        f"Prior turn memory:\n{memory_text}\n\n"
                        f"Question: {question}"
                    )
                ),
            ]
        )
        answer = str(response.content)

        logger.info(
            "Researcher | %.0fms chunks=%d memory_facts=%d answer_preview=%r",
            (time.perf_counter() - t0) * 1000,
            len(context),
            len(memory_facts),
            _preview(answer),
        )
        return {"context": context, "citations": citations, "final_answer": answer}

    return researcher_node


# ── Node 3: Coder

_CODER_SYSTEM_CODE = (
    "You are an expert Python/Jython developer for Ignition SCADA. "
    "Generate clean, well-commented code that solves the task. "
    "Use ONLY the functions and APIs mentioned in the provided context. "
    "Return a complete, runnable code snippet."
)

_CODER_SYSTEM_IMPROVE = (
    "You are a precise knowledge assistant. "
    "Rewrite the answer to fix the issues identified by the reviewer. "
    "Stay strictly grounded in the provided context. "
    "Cite sources with [n] indices. "
    "Do NOT add information that is not present in the context."
)


def make_coder_node(
    api_key: str,
) -> Callable[[AgentState], Awaitable[dict[str, Any]]]:
    """Return coder_node — generates or improves code / text answers from context.

    Called both for initial code generation (route='coder') and for improving
    a failed answer on reviewer retry (any route).
    """

    async def coder_node(state: AgentState) -> dict[str, Any]:
        route = state.get("route", "researcher")
        errors = state.get("errors", [])
        retry = state.get("retry_count", 0)
        ctx_text = _context_text(state["context"])
        question = state["question"]

        if route == "coder":
            system = _CODER_SYSTEM_CODE
            if errors:
                error_block = "\n".join(f"- {e}" for e in errors)
                user_msg = (
                    f"Context:\n{ctx_text}\n\n"
                    f"Task: {question}\n\n"
                    f"Previous attempt (retry {retry}):\n{state.get('code_snippet') or ''}\n\n"
                    f"Issues to fix:\n{error_block}"
                )
            else:
                user_msg = f"Context:\n{ctx_text}\n\nTask: {question}"
        else:
            system = _CODER_SYSTEM_IMPROVE
            error_block = "\n".join(f"- {e}" for e in errors)
            user_msg = (
                f"Context:\n{ctx_text}\n\n"
                f"Question: {question}\n\n"
                f"Previous answer (retry {retry}):\n{state.get('final_answer') or ''}\n\n"
                f"Issues to fix:\n{error_block}"
            )

        llm = _llm(SONNET, api_key)  # always Sonnet for generation quality
        response = await llm.ainvoke(
            [SystemMessage(content=system), HumanMessage(content=user_msg)]
        )
        generated = str(response.content)
        new_retry = retry + 1

        logger.info(
            "Coder | retry=%d route=%s errors=%d question=%r output_preview=%r",
            new_retry,
            route,
            len(errors),
            _preview(question, 120),
            _preview(generated),
        )

        if route == "coder":
            return {"code_snippet": generated, "retry_count": new_retry}
        return {"final_answer": generated, "retry_count": new_retry}

    return coder_node


# ── Node 4: Reviewer

_REVIEWER_SYSTEM = (
    "You are a strict factual accuracy evaluator. "
    "Evaluate whether the provided output is faithfully grounded in the given context.\n\n"
    "For text answers: every claim must be supported by the context.\n"
    "For code: every function/API call must be documented in the context.\n\n"
    "Respond ONLY with valid JSON — no markdown, no explanation:\n"
    '{"score": <float 0.0-1.0>, "issues": [<string>, ...]}\n\n'
    "score=1.0 means fully grounded. score<0.85 means hallucination detected."
)


def _output_to_review(state: AgentState) -> str:
    """Return the generated text to evaluate (code or text answer)."""
    if state.get("route") == "coder":
        return state.get("code_snippet") or ""
    return state.get("final_answer") or ""


def make_reviewer_node(
    api_key: str,
) -> Callable[[AgentState], Awaitable[dict[str, Any]]]:
    """Return reviewer_node — LLM-as-judge faithfulness check (threshold ≥ 0.85)."""

    async def reviewer_node(state: AgentState) -> dict[str, Any]:
        output = _output_to_review(state)
        if not output.strip():
            logger.warning("Reviewer: no output to review")
            return {"faithfulness_score": 0.0, "errors": ["No output to evaluate."]}

        # Debug hooks for deterministic smoke testing.
        fail_always = os.getenv("AGENT_REVIEWER_FORCE_FAIL_ALWAYS", "").strip() in {
            "1",
            "true",
            "TRUE",
        }
        fail_until_raw = os.getenv("AGENT_REVIEWER_FORCE_FAIL_UNTIL", "").strip()
        fail_until = int(fail_until_raw) if fail_until_raw.isdigit() else 0
        retry = int(state.get("retry_count") or 0)
        if fail_always or retry < fail_until:
            issue = (
                "forced reviewer failure for smoke test"
                if fail_always
                else f"forced reviewer failure until retry_count >= {fail_until}"
            )
            logger.warning(
                "Reviewer | forced_fail=1 retry=%d route=%s output_preview=%r",
                retry,
                state.get("route"),
                _preview(output),
            )
            return {"faithfulness_score": 0.0, "errors": [issue]}

        ctx_text = _context_text(state["context"])
        llm = _llm(HAIKU, api_key)  # cheap model is sufficient for evaluation
        response = await llm.ainvoke(
            [
                SystemMessage(content=_REVIEWER_SYSTEM),
                HumanMessage(
                    content=f"Context:\n{ctx_text}\n\nOutput to evaluate:\n{output}"
                ),
            ]
        )

        # ── Parse JSON score
        raw = str(response.content).strip()
        # Strip markdown code fences if the model wraps the JSON
        if raw.startswith("```"):
            inner = raw.split("```")
            raw = inner[1].lstrip("json").strip() if len(inner) > 1 else raw

        try:
            parsed = json.loads(raw)
            score = float(parsed.get("score", 0.5))
            issues = [str(i) for i in parsed.get("issues", [])]
        except (json.JSONDecodeError, ValueError, KeyError) as exc:
            logger.warning("Reviewer: failed to parse response — %s", exc)
            score = 0.5
            issues = [f"Could not parse reviewer response: {exc}"]

        logger.info(
            "Reviewer | score=%.2f threshold=%.2f retry=%d issues=%d "
            "output_preview=%r raw_preview=%r",
            score,
            FAITHFULNESS_THRESHOLD,
            retry,
            len(issues),
            _preview(output),
            _preview(raw),
        )

        if score >= FAITHFULNESS_THRESHOLD:
            # Pass — finalize answer (for coder route, promote code to final_answer)
            final = state.get("final_answer") or output
            if state.get("route") == "coder":
                final = output
            return {"faithfulness_score": score, "errors": [], "final_answer": final}

        return {"faithfulness_score": score, "errors": issues}

    return reviewer_node


# ── Degradation node


async def degradation_node(state: AgentState) -> dict[str, Any]:
    """Terminal node: emit a graceful degradation message after MAX_RETRIES failures."""
    logger.warning(
        "Degradation: max retries (%d) reached for question=%.80r",
        MAX_RETRIES,
        state.get("question", ""),
    )
    msg = (
        "I was unable to generate a sufficiently faithful answer after "
        f"{MAX_RETRIES} attempts. "
        "Please rephrase your question or consult the documentation directly. "
        f"Retrieved context: {len(state.get('context', []))} chunks available."
    )
    return {"final_answer": msg}
