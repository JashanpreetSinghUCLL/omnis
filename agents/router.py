"""RouteLLM model router — zero-cost heuristic dispatch.

Maps question intent to the cheapest model that can handle it:

    simple retrieval  →  claude-haiku-3-5   (fast, cheap)
    code generation   →  claude-sonnet-4    (best code quality)
    complex reasoning →  claude-opus-4      (best reasoning depth)

No LLM call is made here; keyword membership is sufficient for a first pass.
Replace with a fine-tuned RouteLLM classifier for production if routing
accuracy becomes a bottleneck.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

logger = logging.getLogger(__name__)

# ── Model IDs (Sprint 4 mapping)

HAIKU = "claude-haiku-3-5"
SONNET = "claude-sonnet-4"
OPUS = "claude-opus-4"

RouteType = Literal["researcher", "coder"]

# ── Keyword tables

_CODE_KEYWORDS: frozenset[str] = frozenset(
    {
        "write",
        "generate",
        "code",
        "script",
        "function",
        "implement",
        "class",
        "method",
        "jython",
        "python",
        "snippet",
        "programming",
        "how to code",
        "example code",
        "automate",
        "develop",
    }
)

_COMPLEX_KEYWORDS: frozenset[str] = frozenset(
    {
        "compare",
        "analyze",
        "analyse",
        "synthesize",
        "evaluate",
        "pros and cons",
        "trade-off",
        "tradeoff",
        "architecture",
        "design pattern",
        "explain in depth",
        "comprehensive",
        "difference between",
        "why does",
        "what are the implications",
    }
)


# ── Route result


@dataclass(frozen=True)
class ModelRoute:
    route: RouteType
    model_id: str
    reason: str


# ── Public API


def route_question(question: str) -> ModelRoute:
    """Return the routing decision for *question*.

    Reads the question once (lower-cased) and checks membership in keyword sets.
    Logs the decision at INFO so every query has a routing trace in the logs.
    """
    q = question.lower()

    if any(kw in q for kw in _CODE_KEYWORDS):
        decision = ModelRoute(
            route="coder",
            model_id=SONNET,
            reason="code generation detected",
        )
    elif any(kw in q for kw in _COMPLEX_KEYWORDS):
        decision = ModelRoute(
            route="researcher",
            model_id=OPUS,
            reason="complex reasoning detected",
        )
    else:
        decision = ModelRoute(
            route="researcher",
            model_id=HAIKU,
            reason="simple retrieval",
        )

    logger.info(
        "Router | route=%s model=%s reason=%s | question=%.80r",
        decision.route,
        decision.model_id,
        decision.reason,
        question,
    )
    return decision
