# Universal Knowledge Hub — Project Guide

## What we're building

A production-grade GraphRAG knowledge hub that serves as a personal tool, team tool, SaaS product, and portfolio showpiece. The architecture supports the full journey from `docker compose up` to multi-tenant Kubernetes without rewriting core systems.

## Core stack

| Layer | Choice | Why |
|---|---|---|
| API | FastAPI v0.115.x | Industry standard, OpenAI/Anthropic use it |
| Retrieval orchestration | LlamaIndex v0.14.x | Best RAG primitives, 300+ data connectors |
| Graph retrieval | LightRAG (HKU) | 6,000x cheaper than Microsoft GraphRAG |
| Agent memory | Graphiti (Zep) | Bi-temporal knowledge graph, 94.8% DMR accuracy |
| Agent orchestration | LangGraph v1.0 | Durable execution, human-in-the-loop, stable |
| Vector DB | Qdrant | Best self-hosted-to-cloud progression path |
| Graph DB | Neo4j Community → FalkorDB | Ecosystem first, then sub-ms latency at scale |
| Task queue | Taskiq | 5x faster than Celery, native async |
| Observability | Langfuse + Helicone | Self-hostable, OpenTelemetry-native |

## Sub-guides (read these)

- [`docs/CLAUDE-graphrag.md`](docs/CLAUDE-graphrag.md) — GraphRAG architecture, entity extraction, hybrid search, embeddings
- [`docs/CLAUDE-agents.md`](docs/CLAUDE-agents.md) — LangGraph multi-agent orchestration patterns
- [`docs/CLAUDE-stack.md`](docs/CLAUDE-stack.md) — Tech stack decisions (FastAPI, Qdrant, Neo4j, LlamaIndex)
- [`docs/CLAUDE-devex.md`](docs/CLAUDE-devex.md) — CLI design, SSE streaming, async ingestion, LLM testing
- [`docs/CLAUDE-ui.md`](docs/CLAUDE-ui.md) — Knowledge graph viz, chat UI, agent traces, dashboards
- [`docs/CLAUDE-production.md`](docs/CLAUDE-production.md) — Observability, caching, multi-tenancy, security
- [`docs/CLAUDE-deployment.md`](docs/CLAUDE-deployment.md) — Docker → Kubernetes progression, cost optimization, CI/CD

## Development phases

| Phase | Infrastructure | Cost/month |
|---|---|---|
| Prototype (months 1–3) | Docker Compose + Coolify on Hetzner VPS | $0–50 |
| Team tool (months 3–9) | Fly.io + Qdrant Cloud free tier + Neo4j Aura Pro | $100–500 |
| Production SaaS (month 9+) | Kubernetes (EKS/GKE) via Pulumi + Helm | $1,000–10,000 |

## Non-obvious insights that matter most

- **LightRAG over Microsoft GraphRAG** — fewer than 100 tokens/query vs. 610K tokens. Saves thousands monthly.
- **FalkorDB** — 0.4ms cold start vs. Neo4j's 90ms. Use it when graph query feel matters.
- **Taskiq** — 5x faster than Celery. Eliminates ingestion bottlenecks with native async.
- **Voyage 4 shared embedding space** — embed documents with the expensive model, queries with the cheap one. No re-indexing.
- **Schema-first entity extraction** — `enforce_schema=True` eliminates 60–70% of extraction noise.
- **Tiered Qdrant multi-tenancy from day one** — bolting it on later is painful.
- **Evaluation gates in CI/CD** — treat prompt quality as seriously as code quality.
