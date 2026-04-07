"""Graphiti bi-temporal conversation memory for the agent graph.

Each agent session is a named group of episodes in the Graphiti knowledge
graph. Episodes represent Q&A turns and are indexed for retrieval across
sessions via Graphiti's bi-temporal graph model.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)


class GraphitiMemory:
    """Thin async wrapper around Graphiti for agent conversation memory."""

    def __init__(
        self,
        neo4j_uri: str,
        neo4j_user: str,
        neo4j_password: str,
        anthropic_api_key: str,
    ) -> None:
        try:
            from anthropic import AsyncAnthropic  # type: ignore[import-untyped]
            from graphiti_core import Graphiti  # type: ignore[import-untyped]
            from graphiti_core.llm_client.anthropic_client import (  # type: ignore[import-untyped]
                AnthropicClient,
                LLMConfig,
            )

            runtime_model = os.getenv(
                "ROUTER_RUNTIME_HAIKU_MODEL", "claude-haiku-4-5-20251001"
            )
            llm_client = AnthropicClient(
                config=LLMConfig(model=runtime_model),
                client=AsyncAnthropic(api_key=anthropic_api_key),
            )
            self._client: Any = Graphiti(
                neo4j_uri,
                neo4j_user,
                neo4j_password,
                llm_client=llm_client,
            )
            self._available = True
            logger.info("GraphitiMemory: initialized (Neo4j=%s)", neo4j_uri)
        except Exception as exc:
            self._client = None
            self._available = False
            logger.warning("GraphitiMemory: init failed; memory disabled (%s)", exc)

    async def build_indices(self) -> None:
        if not self._available or self._client is None:
            return
        try:
            await self._client.build_indices_and_constraints()
        except Exception as exc:
            logger.warning("GraphitiMemory: build_indices failed (%s)", exc)

    async def store_turn(
        self,
        session_id: str,
        tenant_id: str,
        question: str,
        answer: str,
        citations: list[dict[str, Any]],
    ) -> None:
        if not self._available or self._client is None:
            return

        citation_str = ", ".join(
            str(c.get("source", "")) for c in citations if c.get("source")
        )
        body = f"Question: {question}\n\nAnswer: {answer}"
        if citation_str:
            body += f"\n\nSources: {citation_str}"

        try:
            from graphiti_core.nodes import EpisodeType  # type: ignore[import-untyped]

            await self._client.add_episode(
                name=f"turn:{session_id}:{datetime.now(UTC).isoformat()}",
                episode_body=body,
                source_description="omnis_agent",
                reference_time=datetime.now(UTC),
                episode_type=EpisodeType.text,
                group_id=f"tenant_{tenant_id}",
            )
            logger.debug("GraphitiMemory: stored turn session=%s", session_id)
        except Exception as exc:
            logger.warning("GraphitiMemory: store_turn failed (%s)", exc)

    async def recall_context(
        self,
        tenant_id: str,
        question: str,
        num_results: int = 5,
    ) -> list[str]:
        if not self._available or self._client is None:
            return []
        try:
            results = await self._client.search(
                query=question,
                group_ids=[f"tenant_{tenant_id}"],
                num_results=num_results,
            )
            return [str(getattr(r, "fact", r)) for r in results]
        except Exception as exc:
            logger.warning("GraphitiMemory: recall failed (%s)", exc)
            return []

    async def close(self) -> None:
        if self._client is not None:
            try:
                await self._client.close()
            except Exception as exc:
                logger.warning("GraphitiMemory: close error (%s)", exc)
