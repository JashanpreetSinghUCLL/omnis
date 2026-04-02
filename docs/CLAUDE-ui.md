# Visual UI — Wow Factor Guide

> Part of the [Universal Knowledge Hub](../CLAUDE.md)

## Knowledge graph visualization

### Production explorer: Sigma.js + Graphology

The optimal combination for React:

```
@react-sigma/core + Graphology
```

**Architecture:**
```
Graphology         →  data model and algorithms
Sigma.js           →  WebGL renderer
@react-sigma/core  →  React bindings
```

**Handles 50,000–100,000+ nodes smoothly via WebGL.**

Key packages:
- `graphology-communities-louvain` — automatic cluster detection and coloring
- `graphology-layout-forceatlas2` — organic-looking layouts (run in Web Workers for performance)
- Progressive label density management — labels appear only on zoom

### Demo/portfolio mode: react-force-graph-3d

```
github.com/vasturiano/react-force-graph  # v1.48.2
```

- Stunning 3D force-directed graphs using ThreeJS/WebGL
- Handles ~10–20K nodes
- Identical interfaces across 2D, 3D, VR, and AR packages

**Use react-force-graph-3d for stakeholder demos and the portfolio landing page. Use Sigma.js for the production explorer.**

### Rendering guidance by graph size

| Node count | Renderer |
|---|---|
| < 500 | SVG (D3.js) |
| 500–10K | Canvas |
| 10K–100K | WebGL (Sigma.js) |
| 100K+ | GPU-accelerated WebGL (Cosmos by Cosmograph) |

---

## Chat UI with streaming citations

### Library: assistant-ui

```
github.com/assistant-ui/assistant-ui  # Y Combinator-backed
```

**Provides:**
- Radix-style composable primitives: `<Thread>`, `<MessageList>`, `<Input>`, `<Toolbar>`
- Built-in streaming, auto-scroll, retries, attachments
- Markdown rendering and code highlighting
- Direct Vercel AI SDK + LangGraph integration
- shadcn/ui theme
- Perplexity-style lookalike example

### Citation UX pattern (proven)

1. **Inline numbered superscripts** in response text: `Revenue grew 12% [1]`
2. Clickable references expand to source cards with title/URL/excerpt
3. Collapsible side panel showing all sources

**Architecture:** stream the answer via SSE → send citation metadata via tool calls or structured output with the AI SDK's `StreamData` → render citations as they arrive (not after stream completes).

---

## Agent reasoning traces — the glass box

### Library: AgentPrism

```
github.com/evilmartians/agent-prism  # by Evil Martians
```

Four React components:
- `TreeView` — parent-child agent steps
- `SpanCard` — individual operation details
- `Timeline` — visual replay with play/pause
- Data converters — transforms OpenTelemetry traces into UI schema

Distributed as shadcn-style copyable source code with Radix accessibility.

### Design philosophy: transparency without overwhelm

| Interaction | What's shown |
|---|---|
| Default view | One-line summaries with status icons (✅ ⏳ ❌) |
| Hover | Timing and key details |
| Click | Full inputs, outputs, and reasoning |

**Color-code by step type:** blue for retrieval, green for tool calls, purple for reasoning.

Use **React Flow** (`reactflow.dev`) for DAG-style workflow visualization showing how agent steps connect and branch during parallel tool calls.

---

## Dashboard components

### shadcn/ui + Recharts (recommended)

```
npx shadcn-ui@latest add chart
```

- Full code ownership
- Tailwind integration
- ~50KB gzipped

### Tremor (rapid prototyping)

Acquired by Vercel. 35+ copy-and-paste dashboard components.

### Key metrics to display

- Documents ingested — time series
- Processing pipeline stages — tracker component
- Knowledge graph growth — area chart
- Query volume and latency — line chart with P50/P95/P99
- Token usage and cost breakdown — stacked bar chart
- Retrieval quality scores — scorecard
