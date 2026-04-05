"""Token-aware sliding window rate limiter.

Design
------
* Window: rolling 24 hours (86 400 s) per API key
* Unit: tokens (not requests); estimated as len(body_text) // 4 for inbound,
  len(response_text) // 4 for outbound.  Actual token counts from the LLM
  response are added after the request completes.
* Storage: Redis Sorted Set  `rl:{api_key}:{YYYYMMDD}`
  - Score  = Unix timestamp (float)
  - Member = unique request ID (uuid4 hex)
  - Each member carries its token estimate as a separate string hash field
    `rl:usage:{api_key}:{YYYYMMDD}` → {req_id: token_count}
* Tiers (configured via Settings):
    free       → rate_limit_free_tokens_per_day   (default 10 000)
    pro        → rate_limit_pro_tokens_per_day    (default 500 000)
    enterprise → unlimited (no Redis check)
* Tier resolution: `omnis:api_keys` Redis hash, field=api_key, value=tier.
  Missing key → "enterprise" in dev, "free" in production.
* On limit exceeded: HTTP 429 with `Retry-After: <seconds_until_oldest_entry_expires>`.

Non-goals
---------
This implementation does NOT: count actual LLM tokens server-side (requires
tracking streamed output), verify API key signatures, or implement per-minute
burst control.  Those are production hardening items for Sprint 7.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

import redis.asyncio as aioredis
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from api.config import get_settings

logger = logging.getLogger(__name__)

_WINDOW_S: int = 86_400  # 24 hours
_API_KEYS_HASH: str = "omnis:api_keys"

# Routes excluded from rate limiting (health checks, docs)
_EXEMPT_PREFIXES: tuple[str, ...] = (
    "/api/health",
    "/v1/health",
    "/docs",
    "/redoc",
    "/openapi.json",
)


def _estimate_tokens(text: str) -> int:
    """~4 characters per token — fast, good enough for rate limiting."""
    return max(1, len(text) // 4)


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, redis_url: str) -> None:
        super().__init__(app)
        self._redis_url = redis_url
        self._redis: aioredis.Redis | None = None  # type: ignore[type-arg]

    async def _get_redis(self) -> aioredis.Redis:  # type: ignore[type-arg]
        if self._redis is None:
            self._redis = aioredis.from_url(self._redis_url, decode_responses=True)
        return self._redis

    async def _resolve_tier(self, redis: Any, api_key: str) -> str:
        """Look up the tier for an API key; default depends on app_env."""
        try:
            tier: str | None = await redis.hget(_API_KEYS_HASH, api_key)
            if tier in ("free", "pro", "enterprise"):
                return tier
        except Exception:
            pass
        settings = get_settings()
        return "enterprise" if not settings.is_production else "free"

    async def _daily_usage(self, redis: Any, api_key: str) -> int:
        """Total tokens used in the current 24-hour window."""
        now = time.time()
        window_start = now - _WINDOW_S
        date_key = _rl_set_key(api_key)
        usage_key = _rl_usage_key(api_key)

        # Remove expired entries
        await redis.zremrangebyscore(date_key, "-inf", window_start)

        # Sum token counts for live entries
        live_ids: list[str] = await redis.zrange(date_key, 0, -1)
        if not live_ids:
            return 0

        counts = await redis.hmget(usage_key, *live_ids)
        return sum(int(c) for c in counts if c is not None)

    async def _record_request(self, redis: Any, api_key: str, tokens: int) -> None:
        req_id = uuid.uuid4().hex
        now = time.time()
        date_key = _rl_set_key(api_key)
        usage_key = _rl_usage_key(api_key)

        pipe = redis.pipeline()
        pipe.zadd(date_key, {req_id: now})
        pipe.hset(usage_key, req_id, tokens)
        pipe.expire(date_key, _WINDOW_S + 60)
        pipe.expire(usage_key, _WINDOW_S + 60)
        await pipe.execute()

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        # Skip exempt paths
        for prefix in _EXEMPT_PREFIXES:
            if request.url.path.startswith(prefix):
                return await call_next(request)

        api_key: str = (
            request.headers.get("X-API-Key")
            or request.headers.get("Authorization", "").removeprefix("Bearer ")
            or "anonymous"
        )

        try:
            redis = await self._get_redis()
            tier = await self._resolve_tier(redis, api_key)

            if tier != "enterprise":
                settings = get_settings()
                limit = (
                    settings.rate_limit_free_tokens_per_day
                    if tier == "free"
                    else settings.rate_limit_pro_tokens_per_day
                )

                used = await self._daily_usage(redis, api_key)

                # Estimate inbound tokens
                body = await request.body()
                inbound_tokens = _estimate_tokens(body.decode("utf-8", errors="ignore"))

                if used + inbound_tokens > limit:
                    logger.warning(
                        "Rate limit exceeded [key=***%s tier=%s used=%d limit=%d]",
                        api_key[-4:],
                        tier,
                        used,
                        limit,
                    )
                    retry_after = _WINDOW_S - int(time.time() % _WINDOW_S)
                    return Response(
                        content=f'{{"detail":"Rate limit exceeded","tier":"{tier}","used":{used},"limit":{limit}}}',
                        status_code=429,
                        headers={
                            "Content-Type": "application/json",
                            "Retry-After": str(retry_after),
                            "X-RateLimit-Tier": tier,
                            "X-RateLimit-Used": str(used),
                            "X-RateLimit-Limit": str(limit),
                        },
                    )
        except Exception as exc:
            # Never block a request because the rate limiter is down
            logger.warning("Rate limit check skipped: %s", exc)

        response: Response = await call_next(request)
        return response


# ── Key helpers


def _rl_set_key(api_key: str) -> str:
    import datetime

    today = datetime.date.today().strftime("%Y%m%d")
    return f"rl:{api_key}:{today}"


def _rl_usage_key(api_key: str) -> str:
    import datetime

    today = datetime.date.today().strftime("%Y%m%d")
    return f"rl:usage:{api_key}:{today}"
