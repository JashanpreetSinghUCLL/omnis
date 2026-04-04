"""CLI script to run the ingestion pipeline against a PDF.

Usage:
    python ingest.py docs/ignition/890404496-Core-Manual-2024.pdf

Reads all config from .env automatically.
Re-runs are instant — completed stages are skipped via Redis checkpoints.
"""

import asyncio
import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)


async def main(pdf_path: str) -> None:
    from dotenv import load_dotenv
    import os

    load_dotenv()

    from ingestion.pipeline import IngestionConfig, run_ingestion

    cfg = IngestionConfig(
        neo4j_uri=os.getenv("NEO4J_URI", "bolt://localhost:7687"),
        neo4j_user=os.getenv("NEO4J_USER", "neo4j"),
        neo4j_password=os.getenv("NEO4J_PASSWORD", "omnis_dev_password"),
        qdrant_url=os.getenv("QDRANT_URL", "http://localhost:6333"),
        qdrant_api_key=os.getenv("QDRANT_API_KEY") or None,
        redis_url=os.getenv("REDIS_URL", "redis://:omnis_dev_redis@localhost:6379/0"),
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
        voyage_api_key=os.getenv("VOYAGE_API_KEY") or None,
        llama_cloud_api_key=os.getenv("LLAMA_CLOUD_API_KEY") or None,
        collection_name="omnis_docs",
        tenant_id="default",
    )

    result = await run_ingestion(Path(pdf_path), cfg)
    print(result)

    if result.errors:
        print(f"\nErrors ({len(result.errors)}):")
        for e in result.errors[:10]:
            print(f"  {e}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python ingest.py <path/to/file.pdf>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
