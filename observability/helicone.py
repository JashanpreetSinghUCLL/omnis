"""Helicone gateway proxy helpers.

Helicone is a transparent HTTP proxy that sits in front of Anthropic / OpenAI
API endpoints.  No special SDK is required — integration is achieved by:

  1. Changing the ``base_url`` / ``anthropic_api_url`` on the client.
  2. Adding a ``Helicone-Auth`` header carrying the API key.

Helicone records every request/response pair, tracks token usage, computes
cost, and surfaces latency percentiles in its dashboard.  Combined with
Langfuse (which provides deep trace-level analysis), you get two complementary
observability layers:

    Helicone  — gateway metrics: cost/query, RPM, latency P50/P95/P99
    Langfuse  — trace analysis: per-node timing, retrieval scores, faithfulness

Usage
-----
    from observability.helicone import anthropic_client_kwargs

    from langchain_anthropic import ChatAnthropic
    llm = ChatAnthropic(
        model="claude-sonnet-4-6",
        api_key=api_key,
        **anthropic_client_kwargs(),   # injects base_url + headers if key set
        max_tokens=2048,
        temperature=0,
    )
"""

from __future__ import annotations

import os
from typing import Any

HELICONE_ANTHROPIC_BASE_URL = "https://anthropic.helicone.ai"
HELICONE_OPENAI_BASE_URL = "https://oai.helicone.ai/v1"


def helicone_enabled() -> bool:
    """True when ``HELICONE_API_KEY`` is present in the environment."""
    return bool(os.getenv("HELICONE_API_KEY", "").strip())


def anthropic_client_kwargs() -> dict[str, Any]:
    """Return extra kwargs to pass to ``ChatAnthropic`` to route via Helicone.

    Returns an empty dict when Helicone is not configured so callers can always
    do ``ChatAnthropic(..., **anthropic_client_kwargs())`` safely.
    """
    if not helicone_enabled():
        return {}
    key = os.environ["HELICONE_API_KEY"]
    return {
        "anthropic_api_url": HELICONE_ANTHROPIC_BASE_URL,
        "default_headers": {
            "Helicone-Auth": f"Bearer {key}",
            # Disable Helicone's own caching — Omnis manages caching via Redis/Qdrant
            "Helicone-Cache-Enabled": "false",
        },
    }


def openai_base_url() -> str | None:
    """Return Helicone base URL for OpenAI SDK calls, or None."""
    return HELICONE_OPENAI_BASE_URL if helicone_enabled() else None


def openai_default_headers() -> dict[str, str]:
    """Return Helicone headers for OpenAI SDK calls."""
    key = os.getenv("HELICONE_API_KEY", "")
    if not key:
        return {}
    return {"Helicone-Auth": f"Bearer {key}"}
