"""Reranker: Cohere Rerank v3.5 with BAAI/bge-reranker-base local fallback.

Priority
--------
1. Cohere Rerank v3.5 (API) — best quality, ~50ms round-trip
2. BAAI/bge-reranker-base (local CrossEncoder) — no API key required
3. RRF-score passthrough — if both fail, original fused order is preserved

All blocking model/API calls run in a thread-pool executor so the event loop
is never blocked.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from retrieval.fusion import FusedResult

logger = logging.getLogger(__name__)

# Module-level imports so tests can patch them with patch("retrieval.reranker.cohere")
# and patch("retrieval.reranker.CrossEncoder").  Both are optional — if missing,
# the corresponding reranker path raises and the next fallback is used.
try:
    import cohere  # type: ignore[import-untyped]
except ImportError:
    cohere = None  # type: ignore[assignment]

try:
    from sentence_transformers import CrossEncoder  # type: ignore[import-untyped]
except ImportError:
    CrossEncoder = None  # type: ignore[assignment,misc]

_TOP_N = 8
_COHERE_MODEL = "rerank-v3.5"
_LOCAL_MODEL = "BAAI/bge-reranker-base"


# ── Data models


@dataclass
class RankedResult:
    fused: FusedResult
    rerank_score: float
    rerank_rank: int  # 1-based


@dataclass
class RerankerResult:
    ranked: list[RankedResult] = field(default_factory=list)
    latency_ms: float = 0.0
    backend: str = "passthrough"  # "cohere" | "local" | "passthrough"


# ── Reranker


class Reranker:
    """Reranks FusedResult candidates with Cohere Rerank v3.5 or local fallback."""

    def __init__(
        self,
        cohere_api_key: str | None = None,
        top_n: int = _TOP_N,
    ) -> None:
        self._cohere_api_key = cohere_api_key
        self._top_n = top_n
        self._cross_encoder: Any = None  # lazy-loaded local model

    # ── Cohere (sync, called from executor)

    def _cohere_rerank(
        self,
        query: str,
        candidates: list[FusedResult],
    ) -> tuple[list[RankedResult], str]:
        if cohere is None:
            raise ImportError("cohere package not installed")

        co = cohere.Client(api_key=self._cohere_api_key)
        docs = [c.text for c in candidates]

        response = co.rerank(
            model=_COHERE_MODEL,
            query=query,
            documents=docs,
            top_n=min(self._top_n, len(candidates)),
        )

        ranked = [
            RankedResult(
                fused=candidates[res.index],
                rerank_score=float(res.relevance_score),
                rerank_rank=rank,
            )
            for rank, res in enumerate(response.results, start=1)
        ]
        return ranked, "cohere"

    # ── Local CrossEncoder (sync, called from executor)

    def _local_rerank(
        self,
        query: str,
        candidates: list[FusedResult],
    ) -> tuple[list[RankedResult], str]:
        if CrossEncoder is None:
            raise ImportError("sentence-transformers package not installed")

        if self._cross_encoder is None:
            logger.info("Loading local reranker: %s", _LOCAL_MODEL)
            self._cross_encoder = CrossEncoder(_LOCAL_MODEL)

        pairs = [(query, c.text) for c in candidates]
        scores: list[float] = self._cross_encoder.predict(pairs).tolist()

        top = sorted(
            zip(scores, candidates, strict=True),
            key=lambda x: x[0],
            reverse=True,
        )[: self._top_n]

        ranked = [
            RankedResult(fused=c, rerank_score=float(s), rerank_rank=i + 1)
            for i, (s, c) in enumerate(top)
        ]
        return ranked, "local"

    # ── RRF passthrough (no I/O)

    def _passthrough(self, candidates: list[FusedResult]) -> list[RankedResult]:
        return [
            RankedResult(fused=c, rerank_score=c.rrf_score, rerank_rank=i + 1)
            for i, c in enumerate(candidates[: self._top_n])
        ]

    # ── Async public API

    async def rerank(
        self,
        query: str,
        candidates: list[FusedResult],
    ) -> RerankerResult:
        """Rerank candidates and return the top-N with scores.

        Args:
            query:      The original user query string.
            candidates: Up to 20 FusedResult objects from RRF fusion.

        Returns:
            Up to top_n RankedResult objects, sorted by rerank score descending.
        """
        if not candidates:
            return RerankerResult()

        t0 = time.perf_counter()
        loop = asyncio.get_running_loop()
        ranked: list[RankedResult]
        backend: str

        # 1. Try Cohere
        if self._cohere_api_key:
            try:
                ranked, backend = await loop.run_in_executor(
                    None, self._cohere_rerank, query, candidates
                )
                ms = (time.perf_counter() - t0) * 1000
                logger.info(
                    "Reranker[cohere] | %.1fms | %d -> %d",
                    ms,
                    len(candidates),
                    len(ranked),
                )
                return RerankerResult(ranked=ranked, latency_ms=ms, backend=backend)
            except Exception as exc:
                logger.warning("Cohere rerank failed (%s), trying local fallback", exc)

        # 2. Try local CrossEncoder
        try:
            ranked, backend = await loop.run_in_executor(
                None, self._local_rerank, query, candidates
            )
            ms = (time.perf_counter() - t0) * 1000
            logger.info(
                "Reranker[local] | %.1fms | %d -> %d",
                ms,
                len(candidates),
                len(ranked),
            )
            return RerankerResult(ranked=ranked, latency_ms=ms, backend=backend)
        except Exception as exc:
            logger.error("Local reranker failed (%s), using RRF passthrough", exc)

        # 3. Passthrough fallback
        ranked = self._passthrough(candidates)
        ms = (time.perf_counter() - t0) * 1000
        logger.warning("Reranker[passthrough] | %.1fms", ms)
        return RerankerResult(ranked=ranked, latency_ms=ms, backend="passthrough")
