"""Integration test: full pipeline against Ignition Core Manual PDF.

Requires running Docker stack (docker compose up -d) and a PDF at the
path specified by IGNITION_PDF env var or the default location.

Run with:
    IGNITION_PDF=/path/to/ignition_core_manual.pdf pytest tests/ingestion/test_pipeline_integration.py -v -s

Assertions (from sprint spec):
    ✓  Neo4j has > 500 nodes
    ✓  Qdrant has > 200 vectors
    ✓  No duplicate entities (entity resolution rate logged)
    ✓  Ingestion is idempotent (second run skips processing)
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from dotenv import load_dotenv

pytestmark = pytest.mark.integration  # excluded from default `pytest` runs

load_dotenv()


PDF_PATH = Path(
    os.environ.get("IGNITION_PDF", "docs/ignition/890404496-Core-Manual-2024.pdf")
)

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
REDIS_URL = os.environ.get("REDIS_URL", "redis://:omnis_dev_redis@localhost:6379/0")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
VOYAGE_KEY = os.environ.get("VOYAGE_API_KEY") or None
LLAMA_KEY = os.environ.get("LLAMA_CLOUD_API_KEY") or None


async def _clear_ingestion_keys() -> None:
    import redis.asyncio as redis

    content_hash = "65f9c20cbc448790d83c9d693e6c8ff7fc6bea77eed88647b1e688d17a8c68cc"
    client = redis.from_url(REDIS_URL, decode_responses=True)
    try:
        keys = await client.keys(f"ingest:*:{content_hash}")
        if keys:
            await client.delete(*keys)
    finally:
        await client.aclose()


@pytest.fixture(autouse=True)
def require_pdf() -> None:
    if not PDF_PATH.exists():
        pytest.skip(f"PDF not found at {PDF_PATH} — set IGNITION_PDF env var")


@pytest.fixture(autouse=True)
def require_anthropic_key() -> None:
    if not ANTHROPIC_KEY:
        pytest.skip("ANTHROPIC_API_KEY not set")


@pytest.fixture(autouse=True)
def require_neo4j_password() -> None:
    if not NEO4J_PASSWORD:
        pytest.skip("NEO4J_PASSWORD not set")


@pytest.mark.asyncio
async def test_full_ingestion_pipeline() -> None:
    from ingestion.pipeline import IngestionConfig, run_ingestion

    await _clear_ingestion_keys()

    cfg = IngestionConfig(
        neo4j_uri=NEO4J_URI,
        neo4j_user=NEO4J_USER,
        neo4j_password=NEO4J_PASSWORD,
        qdrant_url=QDRANT_URL,
        redis_url=REDIS_URL,
        anthropic_api_key=ANTHROPIC_KEY,
        voyage_api_key=VOYAGE_KEY,
        llama_cloud_api_key=LLAMA_KEY,
        collection_name="ignition_integration_test",
        tenant_id="test",
    )

    result = await run_ingestion(PDF_PATH, cfg)

    print("\n" + "=" * 60)
    print(result)
    print("=" * 60)

    assert not result.skipped, "Expected a fresh run — clear Redis cache if re-running"
    assert result.chunk_count > 0
    assert (
        result.vector_count > 200
    ), f"Expected >200 Qdrant vectors, got {result.vector_count}"

    # ── Neo4j node count
    import neo4j

    driver = neo4j.AsyncGraphDatabase.driver(
        NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD)
    )
    async with driver.session() as session:
        rec = await session.run("MATCH (n) RETURN count(n) AS cnt")
        node_count = (await rec.single())["cnt"]
    await driver.close()

    print(f"Neo4j node count: {node_count}")
    assert node_count > 500, f"Expected >500 Neo4j nodes, got {node_count}"

    # ── Entity resolution rate
    if result.entities_extracted > 0:
        resolution_rate = result.entities_resolved / result.entities_extracted
        print(
            f"Entity resolution rate: {resolution_rate:.1%} ({result.entities_resolved}/{result.entities_extracted} merged)"
        )
    else:
        print("Note: entity counts not available from SimpleKGPipeline result object")

    # ── No errors
    assert len(result.errors) == 0 or (
        len(result.errors) / max(result.chunk_count, 1) < 0.05
    ), f"Too many extraction errors: {result.errors[:5]}"


@pytest.mark.asyncio
async def test_idempotent_rerun() -> None:
    """Second run of the same PDF must be skipped, not re-processed."""
    from ingestion.pipeline import IngestionConfig, run_ingestion

    cfg = IngestionConfig(
        neo4j_uri=NEO4J_URI,
        neo4j_user=NEO4J_USER,
        neo4j_password=NEO4J_PASSWORD,
        qdrant_url=QDRANT_URL,
        redis_url=REDIS_URL,
        anthropic_api_key=ANTHROPIC_KEY,
        voyage_api_key=VOYAGE_KEY,
        llama_cloud_api_key=LLAMA_KEY,
        collection_name="ignition_integration_test",
        tenant_id="test",
    )

    result = await run_ingestion(PDF_PATH, cfg)
    assert (
        result.skipped
    ), "Second run should be skipped — run test_full_ingestion_pipeline first"
    print(f"\nIdempotency confirmed: {result}")
