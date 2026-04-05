"""Langfuse observability helpers.

Two integration modes
---------------------
1. ``@observe()`` decorator — wrap any async function as a LangFuse span.
   The decorator auto-captures latency, input, output, and errors.

2. Manual SDK calls — use ``get_langfuse_client()`` for explicit
   trace/span/generation objects (used by the ingestion pipeline).

Alert thresholds (monitored via Langfuse Dashboard → Alerts):
    COST_PER_QUERY_ALERT_USD  >$0.02 per query
    LATENCY_P95_ALERT_MS      >5 000 ms P95
    FAITHFULNESS_ALERT_THRESHOLD  <0.75 reviewer score

Usage
-----
    # Decorator style (agent nodes)
    from langfuse.decorators import observe, langfuse_context

    @observe(name="researcher")
    async def my_node(state):
        langfuse_context.update_current_observation(
            model="claude-sonnet-4-6",
            usage={"input": 512, "output": 256},
        )

    # Manual style (ingestion pipeline)
    from observability.langfuse import get_langfuse_client

    lf = get_langfuse_client()
    trace = lf.trace(name="ingestion", input={"file": "doc.pdf"})
    with trace.span(name="parse") as span:
        ...
        span.end(output={"pages": 42})
    lf.flush()
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any

logger = logging.getLogger(__name__)

# ── Alert thresholds ──────────────────────────────────────────────────────────
# These values are used both here (for programmatic checks) and are documented
# for manual configuration in the Langfuse dashboard.

COST_PER_QUERY_ALERT_USD: float = 0.02
LATENCY_P95_ALERT_MS: int = 5_000
FAITHFULNESS_ALERT_THRESHOLD: float = 0.75

# Anthropic model cost table (USD per 1 000 tokens, as of 2026-04)
_MODEL_COST_PER_1K: dict[str, tuple[float, float]] = {
    # model_id: (input_cost, output_cost)
    "claude-haiku-4-5-20251001": (0.00025, 0.00125),
    "claude-sonnet-4-6": (0.003, 0.015),
    "claude-opus-4-6": (0.015, 0.075),
}


def estimate_cost_usd(model_id: str, input_tokens: int, output_tokens: int) -> float:
    """Return estimated USD cost for a single LLM call."""
    costs = _MODEL_COST_PER_1K.get(model_id, (0.003, 0.015))
    return (input_tokens * costs[0] + output_tokens * costs[1]) / 1000


def _langfuse_env() -> dict[str, str]:
    return {
        "host": os.getenv("LANGFUSE_HOST", "http://localhost:3000"),
        "public_key": os.getenv("LANGFUSE_PUBLIC_KEY", "lf-pk-omnis-dev"),
        "secret_key": os.getenv("LANGFUSE_SECRET_KEY", "lf-sk-omnis-dev"),
    }


@lru_cache(maxsize=1)
def get_langfuse_client() -> Any:
    """Return a cached Langfuse SDK client.

    Lazily imports langfuse so tests that don't need observability can import
    the rest of the codebase without the SDK installed.
    """
    try:
        from langfuse import Langfuse  # type: ignore[import-untyped]
    except ImportError as exc:
        raise RuntimeError(
            "langfuse package is not installed — run: pip install langfuse"
        ) from exc

    env = _langfuse_env()
    client = Langfuse(
        host=env["host"],
        public_key=env["public_key"],
        secret_key=env["secret_key"],
        debug=False,
    )
    logger.info("Langfuse client initialised | host=%s", env["host"])
    return client


def noop_observe(name: str = "") -> Any:
    """Return a no-op decorator to use when langfuse is unavailable."""

    def decorator(fn: Any) -> Any:
        return fn

    return decorator


def safe_observe(**kwargs: Any) -> Any:
    """Return ``langfuse.decorators.observe`` or a no-op if langfuse is absent."""
    try:
        from langfuse.decorators import observe  # type: ignore[import-untyped]

        return observe(**kwargs)
    except ImportError:
        return noop_observe(**kwargs)


def try_update_observation(**kwargs: Any) -> None:
    """Call ``langfuse_context.update_current_observation`` if langfuse is available."""
    try:
        from langfuse.decorators import (  # type: ignore[import-untyped]
            langfuse_context,
        )

        langfuse_context.update_current_observation(**kwargs)
    except (ImportError, Exception):
        pass
