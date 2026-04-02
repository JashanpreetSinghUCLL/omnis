# Deployment & Cost Optimization

> Part of the [Universal Knowledge Hub](../CLAUDE.md)

## Progression: Docker Compose → Kubernetes

| Stage | Infrastructure | Monthly cost |
|---|---|---|
| Prototype (months 1–3) | Docker Compose locally, deploy via **Coolify** on Hetzner VPS | $0–50 |
| Team tool (months 3–9) | **Fly.io** or Coolify multi-server + Qdrant Cloud free tier + Neo4j Aura Pro | $100–500 |
| Production SaaS (month 9+) | **Kubernetes** (EKS/GKE) via Pulumi + Helm charts | $1,000–10,000 |

**Start with Docker Compose. Deploy to a Coolify VPS for $20/month. Validate the GraphRAG pipeline works with real documents. Then scale. The architecture supports this journey without rewriting core systems.**

---

## Infrastructure tools

### IaC: Pulumi with Python

Recommended over Terraform for AI teams — same language as the application.

### Helm charts

```bash
helm install qdrant qdrant/qdrant --namespace vector
helm install neo4j neo4j/neo4j
```

Both use StatefulSets with PVCs:
- Qdrant requires block storage (SSD/NVMe — no NFS)
- Neo4j benefits from separate volume mounts for data, logs, and transaction logs

### GPU workloads: Modal

```
modal.com  # hit unicorn status September 2025
```

- Serverless containers spin up in < 1 second
- Autoscale to zero
- H100s at $3.95/hour billed per-second

Use for burst embedding generation and inference serving.

---

## Cost optimization — 85% savings

### Model routing: RouteLLM (highest impact)

```
LMSYS, open-source, published at ICLR 2025
Drop-in OpenAI client replacement
```

**Route queries by complexity:**

| Tier | Models | Traffic share | Cost |
|---|---|---|---|
| Budget | Claude 3.5 Haiku ($0.25/MTok), GPT-4.1 Nano ($0.05/MTok) | 70% | Very low |
| Mid-tier | Claude Sonnet 4, GPT-4o | 20% | Medium |
| Premium | Claude Opus 4, GPT-5.2 | 10% | High |

**Benchmarked result: 85% cost reduction while maintaining 95% of GPT-4 performance.**

### Stack all optimizations

| Optimization | Savings |
|---|---|
| RouteLLM model routing | 85% of LLM cost |
| Prompt caching (>1,024 token prompts) | 90% on cached reads |
| Batch processing (non-time-sensitive) | 50% via OpenAI Batch API |
| Self-hosted BGE-M3 on Modal | Near-zero embedding cost |

**Combined result:** A system processing 10K queries/day drops from ~$1,125/month (all GPT-4o) to ~$100–175/month.

---

## CI/CD with LLM evaluation gates

LLM apps are non-deterministic. Traditional CI/CD isn't enough.

### Evaluation gates with Promptfoo

```bash
npx promptfoo eval  # runs in GitHub Actions
```

**Block merges if:**
- Faithfulness drops below 0.85
- Hallucination rate exceeds 5%
- Cost per query exceeds $0.01

### Canary deployments with quality monitoring

Use **Argo Rollouts** or **Flagger** on Kubernetes:
- Monitor response quality via LLM-as-judge
- Shift traffic only after quality thresholds are met

Treat prompt quality as seriously as code quality.
