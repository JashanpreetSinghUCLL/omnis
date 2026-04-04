"""Smoke test for the health endpoint."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

REQUIRED_ENV_VARS = {
    "ANTHROPIC_API_KEY": "sk-ant-test",
    "APP_SECRET_KEY": "test_secret_key_32chars_minimum!",
    "NEO4J_PASSWORD": "test_password",
    "REDIS_PASSWORD": "test_redis_pass",
}


@pytest.fixture()
def client() -> TestClient:
    with patch.dict(os.environ, REQUIRED_ENV_VARS, clear=False):
        # Clear lru_cache so Settings re-reads patched env
        from api.config import get_settings

        get_settings.cache_clear()

        from api.main import create_app

        return TestClient(create_app(), raise_server_exceptions=True)


def test_health_returns_200(client: TestClient) -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200


def test_health_response_schema(client: TestClient) -> None:
    data = client.get("/api/health").json()
    assert data["status"] == "ok"
    assert "version" in data
