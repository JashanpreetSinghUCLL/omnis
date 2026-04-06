# Omnis — Universal Knowledge Hub

[![CI](https://github.com/YOUR_ORG/omnis/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_ORG/omnis/actions/workflows/ci.yml)

> Production-grade GraphRAG knowledge hub. Personal tool → team tool → SaaS — no rewrites.

## Setup in 3 commands

```bash
cp .env.example .env          # 1. copy env template and fill in your API keys
docker compose up --build -d  # 2. build + boot API · worker · UI · infra
docker compose logs -f api worker  # 3. watch backend + worker logs
```

**UI:** http://localhost:5173
**API docs:** http://localhost:8000/docs
**Langfuse observability:** http://localhost:3000
**Qdrant dashboard:** http://localhost:6333/dashboard
**Neo4j browser:** http://localhost:7474

---

## Architecture

```
omnis/
├── ingestion/      # connectors · processors · pipelines (LlamaIndex)
├── databases/      # Qdrant · Neo4j · Redis client wrappers
├── agents/         # LangGraph orchestration · Graphiti memory · graph agents
├── api/            # FastAPI routes · middleware · schemas · config
├── ui/             # Next.js (Sprint 4+)
├── cli/            # Typer CLI (Sprint 3+)
└── evals/          # DeepEval datasets · metrics · runners
```

## Stack

| Layer | Tech |
|---|---|
| API | FastAPI 0.115 |
| Retrieval | LlamaIndex 0.12 + LightRAG |
| Agents | LangGraph 1.0 + Graphiti memory |
| Vector DB | Qdrant 1.16 |
| Graph DB | Neo4j 5.26 Community |
| Task queue | Taskiq + Redis 7 |
| Observability | Langfuse 3 (Postgres + ClickHouse) |

## Services (docker compose)

| Service | Port | Notes |
|---|---|---|
| UI | 5173 | Frontend (Nginx serving Vite build) |
| API | 8000 | FastAPI app |
| Worker | internal | Taskiq ingestion worker |
| Qdrant | 6333 (HTTP) · 6334 (gRPC) | Vector store |
| Neo4j | 7474 (Browser) · 7687 (Bolt) | Graph store |
| Redis | 6379 | Cache + task broker |
| Langfuse | 3000 | Observability UI |
| Langfuse Postgres | internal | Metadata store |
| Langfuse ClickHouse | internal | Trace analytics |

## Dev workflow

```bash
# Install pre-commit hooks (blocks commits on lint/type/test failures)
pre-commit install

# Run smoke tests
pytest tests/smoke/ -v

# Lint + format
ruff check . && ruff format .

# Type check
mypy api/
```

## Environment variables

Copy `.env.example` → `.env` and supply:

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `APP_SECRET_KEY` | Yes | HMAC signing key |
| `NEO4J_PASSWORD` | Yes | Neo4j password |
| `REDIS_PASSWORD` | Yes | Redis AUTH password |
| `VOYAGE_API_KEY` | No | Voyage AI embeddings |

See `.env.example` for all variables with defaults.
