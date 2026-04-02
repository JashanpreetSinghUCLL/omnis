# Developer Experience

> Part of the [Universal Knowledge Hub](../CLAUDE.md)

## CLI design — learn from Simon Willison's `llm`

Reference: `github.com/simonw/llm` (v0.27+)

**Killer patterns to copy:**
- Plugin architecture (`llm install llm-anthropic`)
- Unix pipe composability (`cat code.py | llm -s "Explain this"`)
- SQLite-backed logging of every prompt/response
- Template system for reusable prompts

### Libraries

| Library | Version | Role |
|---|---|---|
| **Typer** | v0.14.0 | "The FastAPI of CLIs" — the base framework |
| **Rich** | v14.5.0 | Tables, progress bars, live updates |
| **Textual** | latest | Full TUI dashboards |

Enable rich markup: `typer.Typer(rich_markup_mode='rich')`

**Key patterns:**
- Progressive disclosure — simple defaults, powerful options
- Shell completion for Bash/Zsh/Fish
- JSON output mode for piping
- Rich error panels instead of raw tracebacks

---

## API design — SSE streaming with typed events

### Why SSE, not WebSocket

SSE is the correct choice for LLM token streaming (used by OpenAI, Anthropic, virtually all production LLM APIs):
- Works through all HTTP proxies
- Auto-reconnects via the EventSource API
- Scales horizontally without sticky sessions
- Simpler to implement

Upgrade to WebSocket only for tool approval flows or real-time collaboration.

### Typed event protocol

Don't stream raw text. Emit structured events:

```json
{"type": "delta",       "content": "Hello"}
{"type": "tool_start",  "name": "search"}
{"type": "tool_result", "result": [...]}
{"type": "final",       "value": {"answer": "...", "citations": [], "usage": {"tokens": 150}}}
```

**Required headers:**
```
Cache-Control: no-cache
X-Accel-Buffering: no    ← disables nginx buffering (common gotcha)
```

**Target TTFT (Time to First Token):** 300–700ms

---

## Async ingestion — Taskiq is the new standard

```
github.com/taskiq-python/taskiq
```

**Benchmark (20,000 jobs):**

| Queue | Time |
|---|---|
| **Taskiq** | **2.03s** |
| Celery | 11.68s |
| RQ | 51.05s |

- Uses Redis Stream as broker (more reliable than Redis lists)
- Full async/await support
- Integrates naturally with FastAPI

### Progress tracking pattern

Publish progress events to Redis pub/sub → bridge to WebSocket connections → real-time UI updates.

**Alternative**: If already invested in Celery, use **Dramatiq** — tasks acknowledged on completion (not on pull), safer defaults.

---

## Testing LLM systems — three-layer approach

### Layer 1: CI/CD gate — DeepEval

```
github.com/confident-ai/deepeval
```

- pytest integration: `deepeval test run tests/test_rag.py`
- 50+ metrics: `FaithfulnessMetric`, `AnswerRelevancyMetric`, `ContextualPrecision`
- **Self-explaining metrics** — tells you *why* the score can't be higher. Critical for debugging.

### Layer 2: Batch validation — RAGAS

- Holistic RAG pipeline evaluation
- Reference-free, lightweight
- Endorsed at OpenAI Dev Day

### Layer 3: Production monitoring — Phoenix by Arize

```
github.com/Arize-ai/phoenix  # 7,800+ stars
```

- OpenTelemetry-native, self-hostable
- Auto-instruments LangChain/LlamaIndex with `auto_instrument=True`
