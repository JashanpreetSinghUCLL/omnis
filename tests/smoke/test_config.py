"""Smoke tests — validate config loading and app structure.

These run fast (no I/O, no network) and gate every commit.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest


REQUIRED_ENV_VARS = {
    "ANTHROPIC_API_KEY": "sk-ant-test",
    "APP_SECRET_KEY": "test_secret_key_32chars_minimum!",
    "NEO4J_PASSWORD": "test_password",
    "REDIS_PASSWORD": "test_redis_pass",
}


def _with_test_env() -> dict[str, str]:
    """Return minimal env vars needed for Settings to instantiate."""
    return {**os.environ, **REQUIRED_ENV_VARS}


def test_settings_loads_with_required_vars() -> None:
    """Settings must not raise when all required vars are present."""
    with patch.dict(os.environ, REQUIRED_ENV_VARS, clear=False):
        from api.config import Settings

        s = Settings()
        assert s.app_env == "development"
        assert s.log_level == "INFO"


def test_settings_crashes_on_missing_anthropic_key() -> None:
    """Missing ANTHROPIC_API_KEY must raise ValidationError at startup.

    Pass _env_file=None to prevent pydantic-settings from reading the project
    .env file (which would otherwise supply the key and mask the missing-var error).
    """
    from pydantic import ValidationError

    env = {k: v for k, v in REQUIRED_ENV_VARS.items() if k != "ANTHROPIC_API_KEY"}
    with patch.dict(os.environ, env, clear=True):
        with pytest.raises(ValidationError):
            from api.config import Settings

            Settings(_env_file=None)  # type: ignore[call-arg]


def test_settings_secret_key_has_dev_default() -> None:
    """APP_SECRET_KEY has a default for dev; it does NOT crash when omitted.

    The field is intentionally optional so docker compose up works without a
    .env file.  Production enforcement happens via the model validator
    (not a missing-field error).
    """
    env = {k: v for k, v in REQUIRED_ENV_VARS.items() if k != "APP_SECRET_KEY"}
    with patch.dict(os.environ, env, clear=True):
        from api.config import Settings

        s = Settings(_env_file=None)  # type: ignore[call-arg]
    assert "dev-secret" in s.app_secret_key.get_secret_value()


def test_is_production_flag() -> None:
    """is_production must return True only in production env."""
    with patch.dict(os.environ, {**REQUIRED_ENV_VARS, "APP_ENV": "production"}):
        from api.config import Settings

        s = Settings()
        assert s.is_production is True


def test_is_not_production_in_dev() -> None:
    with patch.dict(os.environ, {**REQUIRED_ENV_VARS, "APP_ENV": "development"}):
        from api.config import Settings

        s = Settings()
        assert s.is_production is False
