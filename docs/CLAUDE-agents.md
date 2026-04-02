# Multi-Agent Orchestration

> Part of the [Universal Knowledge Hub](../CLAUDE.md)

## Framework: LangGraph v1.0

LangGraph reached v1.0 in late 2025 and is now the default runtime for LangChain agents. Framework overhead is ~14ms per invocation — negligible against LLM inference latency.

**Production features that make it the right choice:**
- **Durable execution** — agents persist through failures and can resume
- **Human-in-the-loop** — built-in approval flows
- **Comprehensive memory** — short-term via checkpointers, long-term via stores
- **LangSmith integration** — observability out of the box

---

## Three agent patterns for a knowledge hub

### 1. Supervisor–Worker (query routing)

A supervisor agent classifies incoming requests and delegates to specialized workers:
- Query agent
- Ingestion agent
- Research agent

Use `langgraph-supervisor-py`:
- `create_supervisor` + `create_handoff_tool` for agent delegation
- `create_forward_message_tool` to forward worker responses directly, saving tokens on the supervisor's context window

### 2. Self-Correcting Loops (answer quality)

```
Query agent → generate answer
     ↓
Critic node → evaluate faithfulness + relevance
     ↓
[pass] → output
[fail] → improvement node → retry
```

Implemented via conditional edges that check quality scores and route to either output or retry.

### 3. Orchestrator–Worker with parallel fan-out (document processing)

LangGraph's `Send` API enables parallel execution:

```python
[Send("process_chunk", {"chunk": c}) for c in chunks]
```

An orchestrator divides a document into sections, then fans out processing to multiple workers simultaneously.

---

## Complementary frameworks

**CrewAI** — role-based agent teams. Used by 60% of Fortune 500. Worth layering on top for specific collaborative workflows. ($18M Series A)

**DSPy** — prompt optimization framework. Define your pipeline in LangGraph, then use DSPy to automatically optimize prompts within each node.

---

## Practical architecture

```
LlamaIndex   →  retrieval and indexing
LangGraph    →  agent orchestration
LightRAG     →  graph-enhanced retrieval algorithm
```

LangChain's team now positions LangGraph as the primary agent framework. LangChain itself is best for document Q&A pipelines.
