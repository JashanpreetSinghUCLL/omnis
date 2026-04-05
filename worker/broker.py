"""Taskiq broker — Redis Streams, async result backend, retry middleware.

Start workers with:
    taskiq worker worker.broker:broker worker.tasks

The broker reads TASKIQ_BROKER_URL and REDIS_URL directly from env so it can
be imported by the Taskiq CLI before the FastAPI app (and thus before
api.config.Settings) is fully loaded.
"""

from __future__ import annotations

import os

from taskiq import SimpleRetryMiddleware
from taskiq_redis import RedisAsyncResultBackend, RedisStreamBroker

# ── Connection URLs (read env directly — avoid Settings import at CLI startup) ─

_BROKER_URL: str = os.getenv(
    "TASKIQ_BROKER_URL", "redis://:omnis_dev_redis@localhost:6379/1"
)
_RESULT_URL: str = os.getenv("REDIS_URL", "redis://:omnis_dev_redis@localhost:6379/0")

# ── Dead-letter queue key (Redis list)

DLQ_LIST: str = "omnis:dlq:ingest"

# ── Broker assembly

broker: RedisStreamBroker = RedisStreamBroker(
    url=_BROKER_URL,
).with_result_backend(RedisAsyncResultBackend(redis_url=_RESULT_URL))

# Retry middleware: up to 3 attempts total (initial + 2 retries).
# Exponential backoff is applied inside worker/tasks.py using the _retries label.
broker.add_middlewares(SimpleRetryMiddleware(default_retry_count=2))
