"""Application configuration — validated at startup via Pydantic BaseSettings.

All required fields crash-early if missing from the environment.
Optional fields have sensible defaults for local dev.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ──────────────────────────────────────────────────────────
    app_env: Literal["development", "staging", "production"] = "development"
    app_debug: bool = False
    app_secret_key: SecretStr = Field(
        default="dev-secret-change-in-production-!!!", description="HMAC / session signing key"
    )
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    # ── LLM Providers ────────────────────────────────────────────────────────
    anthropic_api_key: SecretStr = Field(..., description="Anthropic API key")
    openai_api_key: SecretStr | None = Field(
        default=None, description="OpenAI API key (optional — Anthropic is primary)"
    )
    voyage_api_key: SecretStr | None = Field(
        default=None, description="Voyage AI embedding key (optional)"
    )

    # ── Ingestion ─────────────────────────────────────────────────────────────
    cohere_api_key: SecretStr | None = Field(
        default=None, description="Cohere embed-v4 key; falls back to local BGE-M3"
    )
    llama_cloud_api_key: SecretStr | None = Field(
        default=None, description="LlamaParse cloud key; falls back to PyMuPDF"
    )

    # ── Qdrant ───────────────────────────────────────────────────────────────
    qdrant_url: AnyHttpUrl = Field(
        default="http://localhost:6333", description="Qdrant REST endpoint"
    )
    qdrant_api_key: SecretStr | None = Field(
        default=None, description="Qdrant API key (empty = no auth)"
    )

    # ── Neo4j ────────────────────────────────────────────────────────────────
    neo4j_uri: str = Field(
        default="bolt://localhost:7687", description="Neo4j Bolt URI"
    )
    neo4j_user: str = Field(default="neo4j")
    neo4j_password: SecretStr = Field(
        default="omnis_dev_password", description="Neo4j password"
    )

    # ── Redis ────────────────────────────────────────────────────────────────
    redis_url: str = Field(
        default="redis://:omnis_dev_redis@localhost:6379/0",
        description="Redis connection URL (includes password)",
    )
    redis_password: SecretStr = Field(
        default="omnis_dev_redis", description="Redis AUTH password"
    )

    # ── Langfuse ─────────────────────────────────────────────────────────────
    langfuse_host: AnyHttpUrl = Field(default="http://localhost:3000")
    langfuse_public_key: str = Field(default="lf-pk-omnis-dev")
    langfuse_secret_key: SecretStr = Field(default="lf-sk-omnis-dev")

    # ── Taskiq ───────────────────────────────────────────────────────────────
    taskiq_broker_url: str = Field(
        default="redis://:omnis_dev_redis@localhost:6379/1"
    )

    # ── Rate limiting ─────────────────────────────────────────────────────────
    rate_limit_free_tokens_per_day: int = Field(
        default=10_000,
        description="Daily token budget for the 'free' API key tier",
    )
    rate_limit_pro_tokens_per_day: int = Field(
        default=500_000,
        description="Daily token budget for the 'pro' API key tier",
    )

    # ── Response cache ────────────────────────────────────────────────────────
    cache_l1_ttl_s: int = Field(
        default=3_600, description="L1 exact-match cache TTL in seconds (1 hour)"
    )
    cache_l2_ttl_s: int = Field(
        default=86_400, description="L2 semantic cache TTL in seconds (24 hours)"
    )
    cache_l2_threshold: float = Field(
        default=0.90, description="Cosine similarity floor for L2 semantic cache hits"
    )

    # ── Derived helpers ──────────────────────────────────────────────────────
    @field_validator("app_secret_key", mode="before")
    @classmethod
    def _reject_default_secret_in_prod(cls, v: str) -> str:
        return v

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def neo4j_password_str(self) -> str:
        return self.neo4j_password.get_secret_value()

    @property
    def anthropic_api_key_str(self) -> str:
        return self.anthropic_api_key.get_secret_value()

    @property
    def openai_api_key_str(self) -> str | None:
        return self.openai_api_key.get_secret_value() if self.openai_api_key else None

    @property
    def cohere_api_key_str(self) -> str | None:
        return self.cohere_api_key.get_secret_value() if self.cohere_api_key else None

    @property
    def llama_cloud_api_key_str(self) -> str | None:
        return self.llama_cloud_api_key.get_secret_value() if self.llama_cloud_api_key else None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached Settings instance.

    Crashes at import-time if required env vars are absent.
    Call once in lifespan; inject via FastAPI Depends elsewhere.
    """
    return Settings()
