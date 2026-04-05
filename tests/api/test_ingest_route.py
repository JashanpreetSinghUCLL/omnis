"""Tests for the ingestion endpoints.

POST /v1/ingest  — file upload → immediate 202 + job_id
GET  /v1/ingest/{job_id}  — job status polling
WS   /v1/ingest/{job_id}/progress  — Redis pub/sub forwarding

All Taskiq and Redis interactions are mocked.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient


# ── Fixtures


@pytest.fixture(autouse=True)
def _patch_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")


@pytest.fixture()
def app() -> Any:
    with (
        patch("worker.broker.broker.startup", new_callable=AsyncMock),
        patch("worker.broker.broker.shutdown", new_callable=AsyncMock),
    ):
        from api.main import create_app

        return create_app()


# ── POST /v1/ingest


@pytest.mark.asyncio
async def test_ingest_returns_202_and_job_id(app: Any) -> None:
    """PDF upload should be accepted immediately with a job_id."""
    mock_kiq = AsyncMock()

    with (
        patch("api.routes.ingest.ingest_document_task") as mock_task,
        patch("api.routes.ingest.broker") as mock_broker,
    ):
        mock_broker.is_worker_process = False
        mock_broker.startup = AsyncMock()
        mock_task.kiq = mock_kiq

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/v1/ingest",
                files={
                    "file": ("report.pdf", b"%PDF-1.4 fake content", "application/pdf")
                },
                params={"tenant_id": "acme"},
            )

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "queued"
    assert "job_id" in body
    assert len(body["job_id"]) == 32  # uuid4 hex

    # Ensure the Taskiq task was kicked
    mock_kiq.assert_awaited_once()
    call_kwargs = mock_kiq.call_args.kwargs
    assert call_kwargs["tenant_id"] == "acme"
    assert call_kwargs["job_id"] == body["job_id"]


@pytest.mark.asyncio
async def test_ingest_rejects_unsupported_extension(app: Any) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/v1/ingest",
            files={"file": ("image.png", b"\x89PNG\r\n", "image/png")},
        )

    assert response.status_code == 422
    assert "Unsupported file type" in response.json()["detail"]


@pytest.mark.asyncio
async def test_ingest_rejects_oversized_file(app: Any) -> None:
    """Files > 100 MB should be rejected with 413."""
    big_content = b"x" * (101 * 1024 * 1024)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/v1/ingest",
            files={"file": ("huge.pdf", big_content, "application/pdf")},
        )

    assert response.status_code == 413


@pytest.mark.asyncio
async def test_ingest_500_when_broker_down(app: Any) -> None:
    """If enqueueing fails, the API returns 500 and cleans up the temp file."""
    with (
        patch("api.routes.ingest.ingest_document_task") as mock_task,
        patch("api.routes.ingest.broker") as mock_broker,
        patch("api.routes.ingest.os.unlink") as mock_unlink,
    ):
        mock_broker.is_worker_process = False
        mock_broker.startup = AsyncMock()
        mock_task.kiq = AsyncMock(side_effect=RuntimeError("Redis down"))

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/v1/ingest",
                files={"file": ("doc.pdf", b"%PDF-1.4", "application/pdf")},
            )

    assert response.status_code == 500
    mock_unlink.assert_called_once()


@pytest.mark.asyncio
async def test_ingest_supports_text_files(app: Any) -> None:
    """Non-PDF document types (txt, md) should be accepted."""
    mock_kiq = AsyncMock()

    with (
        patch("api.routes.ingest.ingest_document_task") as mock_task,
        patch("api.routes.ingest.broker") as mock_broker,
    ):
        mock_broker.is_worker_process = False
        mock_broker.startup = AsyncMock()
        mock_task.kiq = mock_kiq

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/v1/ingest",
                files={"file": ("notes.md", b"# Hello World", "text/markdown")},
            )

    assert response.status_code == 202


# ── GET /v1/ingest/{job_id}


@pytest.mark.asyncio
async def test_job_status_complete(app: Any) -> None:
    """Completed task returns status=complete with the result dict."""
    mock_result = MagicMock()
    mock_result.is_err = False
    mock_result.return_value = {
        "job_id": "abc123",
        "status": "complete",
        "chunk_count": 42,
        "vector_count": 42,
        "elapsed_ms": 1234.5,
    }

    with patch("api.routes.ingest.broker") as mock_broker:
        mock_broker.result_backend = AsyncMock()
        mock_broker.result_backend.get_result = AsyncMock(return_value=mock_result)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/v1/ingest/abc123")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "complete"
    assert body["result"]["chunk_count"] == 42


@pytest.mark.asyncio
async def test_job_status_failed(app: Any) -> None:
    mock_result = MagicMock()
    mock_result.is_err = True
    mock_result.error = "Neo4j connection refused"

    with patch("api.routes.ingest.broker") as mock_broker:
        mock_broker.result_backend = AsyncMock()
        mock_broker.result_backend.get_result = AsyncMock(return_value=mock_result)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/v1/ingest/bad-job")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "failed"
    assert "Neo4j" in body["error"]


@pytest.mark.asyncio
async def test_job_status_not_found(app: Any) -> None:
    with patch("api.routes.ingest.broker") as mock_broker:
        mock_broker.result_backend = AsyncMock()
        mock_broker.result_backend.get_result = AsyncMock(return_value=None)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/v1/ingest/unknown-id")

    assert response.status_code == 200
    assert response.json()["status"] == "not_found"


# ── Worker task unit tests


@pytest.mark.asyncio
async def test_ingest_task_publishes_progress_and_returns_result() -> None:
    """Unit test for ingest_document_task: mocks IngestionPipeline."""
    from dataclasses import dataclass

    @dataclass
    class FakeResult:
        source: str = "test.pdf"
        content_hash: str = "abc123"
        skipped: bool = False
        page_count: int = 10
        chunk_count: int = 25
        vector_count: int = 25
        entities_extracted: int = 5
        relations_extracted: int = 3
        entities_resolved: int = 2
        errors: list | None = None
        parse_s: float = 0.5
        chunk_s: float = 0.1
        embed_s: float = 1.2
        graph_s: float = 2.0
        vector_s: float = 0.3

        def __post_init__(self) -> None:
            if self.errors is None:
                self.errors = []

    published: list[str] = []

    def _fake_publish(
        redis_client: Any, job_id: str, *args: Any, **kwargs: Any
    ) -> None:
        published.append(
            json.dumps({"job_id": job_id, "stage": args[0], "status": args[1]})
        )

    fake_ctx = MagicMock()
    fake_ctx.message.labels = {"_retries": 0}

    with (
        patch("worker.tasks.publish_progress", side_effect=_fake_publish),
        patch("worker.tasks.aioredis.from_url") as mock_redis_factory,
        patch("api.config.get_settings") as mock_settings,
        patch(
            "ingestion.pipeline.run_ingestion",
            new_callable=AsyncMock,
            return_value=FakeResult(),
        ) as mock_run,
        patch("ingestion.pipeline.IngestionConfig") as mock_cfg_cls,
    ):
        mock_redis = AsyncMock()
        mock_redis_factory.return_value = mock_redis
        mock_settings.return_value = MagicMock(
            neo4j_uri="bolt://localhost:7687",
            neo4j_user="neo4j",
            neo4j_password_str="test-db-secret",  # noqa: S106 — fake credential in test
            qdrant_url=MagicMock(__str__=lambda s: "http://localhost:6333"),
            qdrant_api_key=None,
            redis_url="redis://localhost:6379/0",
            anthropic_api_key_str="sk-ant-test",
            voyage_api_key=None,
            llama_cloud_api_key_str=None,
        )
        mock_cfg_cls.return_value = MagicMock()

        from worker.tasks import ingest_document_task

        result = await ingest_document_task.original_func(
            file_path="/tmp/test.pdf",
            tenant_id="default",
            job_id="job-001",
            ctx=fake_ctx,
        )

    assert result["status"] == "complete"
    assert result["chunk_count"] == 25
    assert result["job_id"] == "job-001"
    mock_run.assert_awaited_once()


@pytest.mark.asyncio
async def test_ingest_task_pushes_to_dlq_on_failure() -> None:
    """Failed tasks must push a record to the DLQ Redis list."""
    fake_ctx = MagicMock()
    fake_ctx.message.labels = {"_retries": 0}

    with (
        patch("worker.tasks.aioredis.from_url") as mock_redis_factory,
        patch("api.config.get_settings", side_effect=RuntimeError("Settings broken")),
        patch("worker.tasks.publish_progress", new_callable=AsyncMock),
    ):
        mock_redis = AsyncMock()
        mock_redis_factory.return_value = mock_redis

        from worker.tasks import ingest_document_task

        with pytest.raises(RuntimeError, match="Settings broken"):
            await ingest_document_task.original_func(
                file_path="/tmp/test.pdf",
                tenant_id="default",
                job_id="job-fail",
                ctx=fake_ctx,
            )

    # DLQ lpush must have been called with the DLQ list name
    mock_redis.lpush.assert_awaited_once()
    dlq_key, dlq_record = mock_redis.lpush.call_args.args
    assert "omnis:dlq:ingest" in dlq_key
    record = json.loads(dlq_record)
    assert record["job_id"] == "job-fail"
    assert "error" in record
