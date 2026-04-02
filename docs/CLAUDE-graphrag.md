# GraphRAG Architecture

> Part of the [Universal Knowledge Hub](../CLAUDE.md)

## Retrieval paradigm: choose one of three

| Approach | Cost/query | Accuracy | When to use |
|---|---|---|---|
| Microsoft GraphRAG | ~610K tokens, hundreds of API calls | Best (70–80% win rate vs. naive RAG) | When budget is unlimited |
| **LightRAG** (recommended) | <100 tokens, 1 API call | ~10% lower on relational QA | **Default choice** |
| Graphiti | N/A (agent memory) | 94.8% on DMR benchmark | Conversational agent memory |

### LightRAG

```
pip install lightrag-hku
```

- Dual-level retrieval: low-level entity matching + high-level thematic key expansion with multi-hop neighbor traversal
- Incremental updates ~50% faster than Microsoft GraphRAG (no community restructuring)
- 6,000x cheaper per query in practice

### Graphiti (Zep)

```
github.com/getzep/graphiti  # Apache 2.0
```

- Bi-temporal knowledge graph: tracks `t_created`, `t_expired`, `t_valid`, `t_invalid` per edge
- 90% latency reduction vs. MemGPT
- Supports Neo4j 5.26+, FalkorDB, Kuzu as backends
- Ships with built-in MCP server for Claude/Cursor integration

### Recommended combined architecture

```
LightRAG graph-building  →  document indexing and retrieval
Graphiti                 →  conversational agent memory
LlamaIndex               →  overall retrieval orchestration
```

---

## Entity extraction — where most projects die

### Why projects fail

1. Diverse PDF layouts break parsers
2. LLM extraction produces noisy entity sets
3. "Apple Inc." and "AAPL" don't get merged
4. Schema-less extraction creates chaotic graphs
5. Cross-chunk references lose their connections

### What actually works: Neo4j GraphRAG Python package

```
github.com/neo4j/neo4j-graphrag-python
```

Pipeline: `DocumentParser → TextSplitter → ChunkEmbedder → SchemaBuilder → LexicalGraphBuilder → LLMEntityRelationExtractor → KGWriter → EntityResolver`

**Critical configuration choices:**

- `enforce_schema=True` — define allowed entity and relationship types upfront. Eliminates 60–70% of extraction noise.
- `temperature=0` — consistency. Variance drops dramatically.
- **Two-layer graph**: lexical graph (Document→Chunk with `NEXT_CHUNK` edges) AND entity graph (extracted entities with `MENTIONS` links back to chunks). Preserves provenance.
- **Post-extraction entity resolution** — run `SpaCySemanticMatchResolver` (cosine similarity) and `FuzzyMatchResolver` (RapidFuzz) after every batch. Without deduplication, graphs fragment into unusable islands.
- **100-token overlap** in 500-token chunks — preserves cross-boundary entity references.
- **Vision LLMs** for PDFs with tables/charts/diagrams (GPT-4V outperforms text-only significantly).

### Alternative path: LlamaIndex

`PropertyGraphIndex` + `SchemaLLMPathExtractor` + `Neo4jPropertyGraphStore` — tighter integration with LlamaIndex retrieval pipeline.

---

## Triple-layer hybrid search

### The four-stage pipeline

**Stage 1** — parallel retrieval (50–100 candidates each):
- BM25 (keyword matching, term rarity)
- Dense vector search (semantic similarity)

**Stage 2** — Reciprocal Rank Fusion:
```
score = Σ 1/(k + rank_position)
```
RRF merges by ranks, not raw scores — BM25 scores and cosine similarities are not linearly comparable.

**Stage 3** — Knowledge graph augmentation:
- Take top vector matches
- Fetch 1–2 hop neighborhood from the graph via Cypher traversal
- Add graph context to candidates

**Stage 4** — Reranking

### Reranker options

| Option | Cost | Notes |
|---|---|---|
| Cohere Rerank v3.0 | $2.00/1K searches | Best API option |
| BAAI/bge-reranker-base | Free (self-host) | Strongest open-source cross-encoder |
| FlashRank | Free | Lightweight, CPU-optimized, no PyTorch dependency |

**Benchmark**: hybrid BM25 + dense + cross-encoder reranking → MRR@5 of **76.46%** vs. 62.19% for BM25 alone.

Qdrant, Weaviate, and Neo4j all support native hybrid search with RRF. Neo4j's `VectorCypherRetriever` and `HybridCypherRetriever` can execute the full pipeline in a single query.

---

## Embedding models

> Changing embedding models later means re-embedding everything. Choose carefully.

| Model | MTEB Score | Dims | Context | Price/1M tokens | Sweet spot |
|---|---|---|---|---|---|
| Voyage-4-large | Best on RTEB | 2048 | 32K | $0.06 | Highest retrieval quality |
| Cohere embed-v4 | 65.2 | 1536 | **128K** | $0.12 | Multimodal (text+images), 100+ languages |
| OpenAI text-embedding-3-large | 64.6 | 3072 | 8K | $0.13 | Ecosystem integration |
| BGE-M3 (BAAI) | 63.0 | 1024 | 8K | **Free** (MIT) | Best open-source, 100+ languages |
| Voyage-3.5-lite | 66.1% acc | 512–2048 | 32K | $0.02 | Best cost/quality ratio |

### Key innovations

**Voyage 4 shared embedding space**: all Voyage 4 variants (nano, lite, standard, large) produce embeddings in the same vector space. Embed documents with the expensive large model and queries with the cheap lite model — no re-indexing needed.

**Cohere embed-v4**: handles text, images, and mixed-modality PDFs in a single vector space with a 128K context window. Most practical for diverse technical documents.

**Self-hosted BGE-M3**: effectively $0.0001/MTok vs. $0.02–0.13 for APIs. Cost-effective above ~1M queries/month.
