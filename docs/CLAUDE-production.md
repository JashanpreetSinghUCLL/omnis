# Production Readiness

> Part of the [Universal Knowledge Hub](../CLAUDE.md)

## Observability: Langfuse + Helicone

### Langfuse (primary)

```
github.com/langfuse/langfuse  # MIT license
```

- Fully open-source, zero feature restrictions when self-hosted
- OpenTelemetry support — traces export to Grafana/Datadog
- Framework-agnostic
- Prompt management with versioning

**Deploy:**
```bash
docker compose up  # requires PostgreSQL + ClickHouse + Redis + S3
```

**Instrument:**
```python
@observe()  # auto-traces Python functions
def my_function(): ...

# Drop-in replacement for all OpenAI calls:
from langfuse.openai import openai
```

### Helicone (gateway layer)

Pair with Langfuse as a proxy gateway:
- Automatic cost tracking
- Built-in caching
- Operational metrics
- ~50–80ms overhead

**Pattern:** Helicone for the gateway layer → Langfuse for deep trace analysis and evaluation. This is the emerging production standard.

---

## Caching: three-layer with Redis

### Layer 1 — Exact match cache (sub-millisecond)

```
Redis: hash(prompt + model params) → cached response
```

### Layer 2 — Semantic cache (40–70% hit rates)

```python
from redisvl.extensions.llmcache import SemanticCache

cache = SemanticCache(
    distance_threshold=0.90,  # start here, tune per domain
    filterable_fields=[{"name": "tenant_id", "type": "tag"}]  # required for multi-tenancy
)
```

Production systems report 40–70% hit rates for FAQ/support workloads → proportional LLM cost reduction.

> ⚠️ Always scope the semantic cache with `tenant_id` — cached responses must never leak across tenants.

### Layer 3 — Embedding cache

Avoid recomputing embeddings for repeated retrieval queries.

---

## Multi-tenancy: Qdrant's tiered approach

Qdrant 1.16+ (November 2025) introduced **tiered multitenancy:**

- Small tenants → payload-based filtering (shared storage)
- Large tenants → dedicated shards (automatic promotion at ~20K vectors)
- Promotion is transparent — no downtime, no reindexing

This solves the "noisy neighbor" problem elegantly.

### Neo4j multi-tenancy

| Tenant size | Strategy |
|---|---|
| High-value enterprise | Database-per-tenant (Enterprise Edition, built-in RBAC) |
| Long-tail smaller tenants | Labeled subgraphs with `tenant_id` properties |

Neo4j's Composite Databases enable cross-tenant queries when needed (shared knowledge base + private tenant data).

---

## Security essentials

### Rate limiting and access control

- **Token-aware rate limiting** (not just request counting) with tiered limits per subscription level
- Scoped API keys with 90-day rotation
- JWT tokens carrying `tenant_id` + role claims
- Middleware that injects tenant filters before every database query

### Prompt injection defense (OWASP LLM Top 10 #1 risk)

Apply Microsoft's **spotlighting** technique:
- Clearly delimit untrusted content from system prompts
- Validate outputs before passing to downstream systems
- Enforce least-privilege tool access for agents

### Compliance

| Standard | Tool | Cost |
|---|---|---|
| SOC 2 | Vanta or Drata | ~$7K/year + $5–12K audit |
| GDPR | Self-hosted Langfuse | Keeps prompt/response data on-premises |

**GDPR critical requirements:**
- Data Protection Impact Assessment for AI processing
- Data Processing Agreements with LLM providers
- Right-to-erasure implementation across vectors and caches
- Self-hosted observability (Langfuse) — keep data on-premises
