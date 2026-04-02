# Technology Stack Decisions

> Part of the [Universal Knowledge Hub](../CLAUDE.md)

## FastAPI — no reason to switch

FastAPI v0.115.x (~80K GitHub stars). Used by OpenAI, Anthropic, and Microsoft.

**Litestar** v2.16.0 benchmarks ~2x faster, but LLM inference dominates latency at 1–5 seconds per request. The speed difference is irrelevant. FastAPI's ecosystem, community, and hiring pool are unmatched.

Use **gRPC** selectively for internal high-frequency agent-to-agent communication.

---

## Qdrant — best self-hosted-to-cloud path

| Phase | Setup | Cost |
|---|---|---|
| Dev | Self-host via Docker | Free (1GB free cloud tier) |
| Team | Docker/Kubernetes + first-class multi-tenancy | Low |
| SaaS | Qdrant Cloud — SOC 2, tenant isolation | Pay as you grow |

**Benchmark** (VectorDBBench, 1M vectors, 1536-dim): Qdrant and Pinecone tie at ~4K QPS for filtered queries. Qdrant's Rust-based filtering engine is exceptional.

**Other options:**
- **Weaviate** — best built-in hybrid search, but resource-hungry above 100M vectors
- **ChromaDB** — prototyping only, not production
- **pgvector + pgvectorscale** — 471 QPS at 99% recall on 50M vectors; competitive if already on PostgreSQL

---

## Graph database: Neo4j vs. FalkorDB

### FalkorDB (dark horse)

```
github.com/FalkorDB/FalkorDB
```

- Successor to RedisGraph with dedicated GraphRAG-SDK
- **0.4ms cold start** vs. Neo4j's 90ms
- ~3x faster point lookups
- Lowest latency on 11 of 12 standard benchmark queries
- Speaks the Bolt protocol — migrate to/from Neo4j with minimal code changes
- Source-available, runs as a Redis module

### Neo4j Community Edition

- GPL-licensed, free
- Largest ecosystem — every LLM framework supports it natively (LlamaIndex, LangChain, LightRAG)
- Enterprise licensing: six figures annually (prohibitive for startups)
- Aura Free: up to 200K nodes/relationships for prototyping
- Aura Professional: ~$65/month

> ⚠️ **KuzuDB was acquired by Apple in October 2025** and its GitHub repository was archived. Do not choose Kuzu for new projects.

### Recommendation

1. Start with **Neo4j Community** for maximum ecosystem compatibility during development
2. Evaluate **FalkorDB** when you need sub-millisecond latency at scale
3. Budget for **Neo4j Aura Professional** if the ecosystem advantages prove essential

---

## LlamaIndex — still the core

LlamaIndex v0.14.x (~44K stars, MIT license).

- Purpose-built for RAG with deep indexing capabilities
- 300+ data connectors via LlamaHub
- `PropertyGraphIndex` directly supports the GraphRAG pattern
- `Neo4jPropertyGraphStore` backend

**The split**: LlamaIndex for retrieval/indexing. LangGraph for orchestration. LightRAG's algorithm for graph-enhanced retrieval.
