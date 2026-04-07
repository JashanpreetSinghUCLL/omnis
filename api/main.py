"""FastAPI application entrypoint."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import get_settings

logger = logging.getLogger(__name__)


def _warm_models() -> None:
    """Download and cache models used at query time.

    Runs in a thread so it doesn't block the event loop.  Errors are logged
    but never propagated — the API starts regardless.
    """
    # 1. Embedding model (bge-small-en-v1.5)
    try:
        from api.routes.ask import _make_embed_fn  # noqa: PLC0415

        settings = get_settings()
        voyage_key = (
            settings.voyage_api_key.get_secret_value() if settings.voyage_api_key else None
        )
        _make_embed_fn(voyage_key)
        logger.info("Embed model pre-warmed")
    except Exception as exc:
        logger.warning("Embed model pre-warm failed (non-fatal): %s", exc)



@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Validate config, start Taskiq broker, and wire up connections at startup."""
    settings = get_settings()  # crashes early on missing required vars
    logging.basicConfig(level=settings.log_level)
    logger.info("Starting Omnis API [env=%s]", settings.app_env)

    # Start the Taskiq broker so the API process can enqueue tasks.
    # Workers run in a separate process (`taskiq worker worker.broker:broker …`).
    from worker.broker import broker  # noqa: PLC0415

    await broker.startup()
    logger.info("Taskiq broker started")

    # Pre-warm the embedding model in a background thread so the first /v1/ask
    # request doesn't block downloading BAAI/bge-small-en-v1.5.
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _warm_models)

    yield

    await broker.shutdown()
    logger.info("Taskiq broker stopped")
    logger.info("Shutting down Omnis API")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Omnis — Universal Knowledge Hub",
        version="0.1.0",
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # ── Rate limiting (token-aware sliding window)
    # Added first so it sits inside the CORS layer — CORS preflight requests
    # bypass rate limiting because RateLimitMiddleware exempts /v1/health etc.
    # and OPTIONS preflight responses are handled by CORSMiddleware before
    # reaching the rate limiter at runtime.
    from api.middleware.rate_limit import RateLimitMiddleware  # noqa: PLC0415

    app.add_middleware(RateLimitMiddleware, redis_url=settings.redis_url)

    # ── CORS — must be added last so it runs outermost (first on every request)
    # Dev: allow all origins.  Production: restrict to ALLOWED_ORIGINS env var
    # (comma-separated list, e.g. "https://app.omnis.io,https://omnis.io").
    # Falls back to deny-all if the var is not set in production — set it.
    _allowed: list[str] = (
        ["*"]
        if not settings.is_production
        else [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Routes
    from api.routes import health, query  # noqa: PLC0415
    from api.routes import ask, ingest, graph  # noqa: PLC0415

    # Legacy /api routes (Sprint 1–4)
    app.include_router(health.router)
    app.include_router(query.router)

    # Versioned /v1 routes (Sprint 5+)
    app.include_router(ask.router)
    app.include_router(ingest.router)
    app.include_router(graph.router)

    return app


app = create_app()
