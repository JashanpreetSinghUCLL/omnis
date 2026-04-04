"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import get_settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Validate config and wire up connections at startup."""
    settings = get_settings()  # crashes early on missing required vars
    logging.basicConfig(level=settings.log_level)
    logger.info("Starting Omnis API [env=%s]", settings.app_env)
    yield
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

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if not settings.is_production else [],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from api.routes import health  # noqa: PLC0415
    app.include_router(health.router)

    return app


app = create_app()
