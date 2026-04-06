# Universal Knowledge Hub — World-Class UI Prompt
## For v0.dev / Figma / Cursor / Lovable

---

## DESIGN DIRECTION

**Aesthetic**: Dark-first, scientific instrument meets editorial journal. Think the interior of a deep-space observatory crossed with a high-end research publication — precise, serious, luminous. Not cyberpunk. Not SaaS-blue. Something you'd find in a CERN research station or a Bloomberg Terminal that went to design school.

**Palette**:
- Background: `#080B0F` (near-black with a blue-black undertone)
- Surface: `#0E1318` (slightly lifted panels)
- Elevated: `#141C24` (cards, modals)
- Border: `#1E2D3D` (subtle structural lines)
- Accent Primary: `#00D9C0` (electric teal — the "alive" color, used sparingly)
- Accent Secondary: `#6B7FFF` (indigo-violet for graph nodes, secondary actions)
- Accent Warm: `#FFB547` (amber — citations, warnings, cost indicators)
- Text Primary: `#E8EDF2` (warm off-white, never pure white)
- Text Secondary: `#7A8FA6` (muted blue-grey)
- Text Tertiary: `#3D5066` (barely visible, labels)
- Danger: `#FF4D6A`
- Success: `#00C48C`

**Typography**:
- Display / Hero: `DM Serif Display` — elegant, editorial weight for big numbers and section titles
- UI / Interface: `IBM Plex Mono` — monospaced, precise, technical feel for labels, metadata, timestamps
- Body / Prose: `Libre Baskerville` — readable, scholarly for answer text and document content
- Code: `JetBrains Mono` — for code snippets in answers

**Motion Philosophy**: Purposeful and measured. Nothing bounces. Answers stream in like a typewriter from a very fast machine. Graph nodes settle with physics. Panels slide with `cubic-bezier(0.16, 1, 0.3, 1)`. No spinners — use skeleton states with a horizontal shimmer scan line.

---

## FULL APPLICATION LAYOUT

### Shell Structure
```
┌──────────────────────────────────────────────────────────────┐
│  TOP NAV BAR (48px, borderless, frosted)                     │
├──────────┬───────────────────────────────────────────────────┤
│          │                                                    │
│  LEFT    │           MAIN CONTENT AREA                       │
│  SIDEBAR │           (changes per route)                     │
│  (220px) │                                                    │
│          │                                                    │
└──────────┴───────────────────────────────────────────────────┘
```

**Top Nav Bar** — `height: 48px`, `background: rgba(8,11,15,0.85)`, `backdrop-filter: blur(20px)`, sticky, `border-bottom: 1px solid #1E2D3D`
- Left: Logo — a small graph node icon (3 connected dots forming a triangle) + wordmark "KnowledgeHub" in IBM Plex Mono, teal accent on "Hub"
- Center: Global search bar — `width: 480px`, placeholder "Ask anything or search your knowledge graph...", `⌘K` shortcut badge on right edge
- Right: [Model indicator pill] [Cost this month badge] [Notifications bell] [Avatar]

**Left Sidebar** — `width: 220px`, `background: #0E1318`, `border-right: 1px solid #1E2D3D`
- Nav items with subtle left-border active indicator in teal
- Items: Chat, Knowledge Graph, Documents, Evaluations, Settings
- Bottom: Usage meter (tokens consumed this month as a thin arc gauge), user plan badge

---

## PAGE 1: CHAT INTERFACE (Primary View)

### Layout
```
┌─ LEFT SIDEBAR ─┬─ CHAT COLUMN (flex-1) ─┬─ CONTEXT PANEL (360px) ─┐
│                │                         │                           │
│  Nav           │  Message thread         │  Citations / Sources      │
│                │                         │  Agent trace              │
│                │  [stream area]          │  Graph context nodes      │
│                │                         │                           │
│                │  [composer]             │                           │
└────────────────┴─────────────────────────┴───────────────────────────┘
```

### Chat Column
- **Message thread**: `max-width: 720px`, centered within column, `padding: 0 48px`
- **User bubble**: Right-aligned, `background: #141C24`, `border: 1px solid #1E2D3D`, `border-radius: 16px 16px 4px 16px`, IBM Plex Mono 13px, max-width 60%
- **Assistant response**: Full width, no bubble. Answer text in Libre Baskerville 16px, line-height 1.75. Inline citation superscripts styled as `[1]` in teal monospace. Code blocks in JetBrains Mono with dark panel background and a top bar showing language + copy button
- **Streaming state**: Text appears token by token with a thin teal cursor bar at the end. NO loading spinner.
- **Agent status bar** (appears ABOVE streaming answer, disappears on completion):
  ```
  ● Researcher    → ● Coder    → ○ Reviewer
  Querying 3 sources...
  ```
  Three dots with connecting lines. Active node pulses with teal glow ring. Completed nodes turn solid. This is the "thinking UI."

### Message Composer
- Floating at bottom, `max-width: 720px`, centered, `margin-bottom: 24px`
- `background: #141C24`, `border: 1px solid #1E2D3D`, `border-radius: 16px`
- Textarea auto-grows, placeholder: "Ask about your knowledge base..."
- Bottom row inside composer: [Attach PDF] [Select model ▾] [Clear] → right side: [character count] [Send button →]
- Send button: `background: #00D9C0`, `color: #080B0F`, `border-radius: 10px`, morphs to a stop square while streaming

### Right Context Panel (`width: 360px`, `border-left: 1px solid #1E2D3D`)
Has 3 tabs: **Sources** | **Trace** | **Graph**

**Sources tab** (default during/after answer):
- Each source = a card: `background: #141C24`, `border: 1px solid #1E2D3D`, `border-radius: 10px`, `padding: 14px`
  - Top: `[1]` citation number in teal + document title in IBM Plex Mono 12px
  - Body: 2-line excerpt in Libre Baskerville 13px, faded
  - Bottom: relevance score bar (thin amber line, 0–100%) + page number
- Cards appear one-by-one as citations stream in (staggered fade-up, 80ms delay each)
- Confidence score shown as a fine horizontal bar at the bottom of each card

**Trace tab** (agent reasoning):
- Timeline visualization using AgentPrism-style layout
- Each step = a row: `[step icon] [node name] [duration] [status badge]`
- Step types color-coded: Retrieval (teal), LLM call (indigo), Tool use (amber), Error (red)
- Expandable: click any step to see inputs/outputs in a monospace code panel
- Retry loops shown as a cycle arrow between Coder → Reviewer → Coder with retry count badge
- Total cost for this query shown at the bottom in amber: `$0.0043`

**Graph tab** (contextual subgraph):
- Mini force-directed graph showing the entities involved in answering this question
- Nodes sized by relevance to the query, colored by entity type
- Teal highlighted nodes = directly cited, grey = supporting context
- "Explore in full graph →" link at bottom

---

## PAGE 2: KNOWLEDGE GRAPH EXPLORER

### Full-canvas layout
```
┌─ SIDEBAR ─┬─────────────────────────────────────────────────────────┐
│           │  TOOLBAR (top, 52px)                                     │
│  Nav      ├─────────────────────────────────────────────────────────┤
│           │                                                          │
│           │            GRAPH CANVAS (fills remainder)               │
│           │            [WebGL Sigma.js render]                       │
│           │                                                          │
│           ├─────────────────────────────────────────────────────────┤
│           │  ENTITY DETAIL PANEL (slide up from bottom, 280px)      │
└───────────┴──────────────────────────────────────────────────────────┘
```

### Graph Canvas
- **Background**: `#080B0F` — pure dark, stars-in-space feel
- **Node rendering**: Circles. Size = degree centrality (min 4px, max 28px). Color = community cluster (8 distinct colors from palette, muted versions)
- **Highlighted nodes** (when entity selected): teal ring halo, 2px glow using `filter: drop-shadow(0 0 6px #00D9C0)`
- **Edges**: `opacity: 0.2`, `stroke: #1E2D3D`, `stroke-width: 0.5px`. On hover of connected node: edges light up to `opacity: 0.8`, `stroke: #00D9C0`
- **Labels**: Only visible at zoom ≥ 1.5. IBM Plex Mono 11px, `fill: #7A8FA6`. Hovered node label always visible.
- **Community clusters**: Soft convex hull shapes behind each cluster (filled with cluster color at 4% opacity, stroke at 15% opacity). Cluster name label floats above hull.

### Toolbar (above graph)
- Left: [Search entities...] input with fuzzy autocomplete dropdown
- Center: [Entity type filter pills] — All · Concept · Component · Process · Person · System (each toggleable, colored to match node type)
- Right: [Layout ▾ — ForceAtlas2 / Circular / Hierarchical] [Zoom to fit] [Export PNG] [Share subgraph]

### Entity Detail Panel (slides up when node clicked)
- `height: 280px`, `background: #0E1318`, `border-top: 1px solid #1E2D3D`
- Left section (`flex: 1`):
  - Entity name in DM Serif Display 22px
  - Entity type pill + community cluster chip
  - Description / summary in Libre Baskerville 14px
  - "Source documents" list with page refs
- Right section (`width: 260px`):
  - Mini relationship list: incoming (←) and outgoing (→) edges, scrollable
  - Each relation: `[relation type]` label + connected entity name, clickable to jump to that node
- Bottom action bar: [Ask about this entity →] [Show in chat] [Copy entity ID]

---

## PAGE 3: DOCUMENTS (Knowledge Base Manager)

### Layout
```
┌─ SIDEBAR ─┬─ UPLOAD ZONE ──┬─ DOCUMENT LIST (flex-1) ─────────────┐
│           │                 │                                        │
│  Nav      │  Drag & Drop    │  Table/Grid toggle                    │
│           │  zone (200px)   │  Sortable, filterable list            │
│           │                 │                                        │
└───────────┴─────────────────┴────────────────────────────────────────┘
```

### Upload Zone
- `border: 2px dashed #1E2D3D`, `border-radius: 16px`, `background: #0E1318`
- Center: Cloud upload icon (teal, 32px) + "Drop PDFs here or click to upload" in IBM Plex Mono
- On drag-over: border shifts to `#00D9C0`, background pulses slightly with teal tint
- On upload: a full-width ingestion progress card replaces the zone:
  ```
  ┌────────────────────────────────────────────────────┐
  │  📄 Ignition_Core_Manual.pdf        3.2 MB         │
  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
  │  ▶ Parsing    ✓ Chunking   ○ Embedding   ○ Graph  │
  │  Stage 2 of 4 · 847 chunks · 00:00:23 elapsed     │
  └────────────────────────────────────────────────────┘
  ```
  Pipeline stages animate left to right. Active stage pulses teal. Completed = checkmark. Each completed stage shows its count (chunks, embeddings, nodes).

### Document List (Table view)
Columns: [Name] [Pages] [Chunks] [Nodes] [Ingested] [Status] [Actions]
- Sortable columns with `↑↓` indicators
- Status badges: `Indexed` (teal), `Processing` (amber pulse), `Failed` (red), `Partial` (orange)
- Each row has hover state: `background: #141C24`
- Actions on hover: [Re-ingest] [Delete] [View graph →]
- Clicking a document name opens a right-side detail panel: full ingestion stats, entity list, "Ask about this document" button

### Grid view toggle:
Document cards in 3-column grid, each card showing:
- Cover color block (generated from document name hash — deterministic but varied)
- Document title, page count
- Entity count + knowledge graph preview (tiny 80px force graph thumbnail)
- Ingested date

---

## PAGE 4: EVALUATIONS DASHBOARD

### Layout: Full width, top stats → charts row → table

### Stats Row (4 metric cards)
```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Faithfulness │  │  Relevancy   │  │  Precision   │  │  Pass rate   │
│    0.91      │  │    0.87      │  │    0.83      │  │   94.2%      │
│  ↑ +0.03     │  │  ↓ -0.01    │  │  → stable    │  │   ↑ +2.1%   │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```
Each card: `background: #0E1318`, metric in DM Serif Display 32px, delta indicator colored green/red/grey. Thin sparkline chart at bottom of each card (last 10 runs).

### Charts Row (3 panels)
- **Panel 1**: Line chart — all 3 RAGAS metrics over last 30 eval runs. Time on X axis. Dashed horizontal line at threshold (0.85 faithfulness). Points below threshold are red dots.
- **Panel 2**: Radar chart — current eval vs baseline. 5 axes: Faithfulness, Relevancy, Precision, Recall, Correctness. Two polygons: baseline (dashed grey) + current (solid teal fill at 15% opacity).
- **Panel 3**: Cost breakdown bar chart — LLM cost per query by model type. Stacked bars: Haiku (teal) + Sonnet (indigo) + Opus (amber). Shows model routing working.

### Test Case Table
Columns: [Question] [Expected] [Got] [Faithfulness] [Relevancy] [Pass/Fail]
- Failing rows: `background: rgba(255,77,106,0.05)`, red left border
- Passing rows: neutral
- Click row → expand to show full question, full expected answer, full generated answer side by side with diff highlights
- Top: [Run eval ▶] button (teal, prominent) + [Filter: All / Passing / Failing] toggle + [Export CSV]

---

## PAGE 5: SETTINGS

### Sidebar sub-nav within settings (left side of content area):
General · API Keys · Models · Ingestion · Multi-tenancy · Billing · Danger zone

### Key sections to design in detail:

**Model Configuration panel**:
- Visual model router diagram: shows the routing logic as a flow
  - Box: "Query complexity classifier" → branches to 3 boxes: "Haiku" (simple), "Sonnet" (medium), "Opus" (complex)
  - Each model box shows: current price/MTok, estimated % of queries routed there, monthly cost
  - Sliders to adjust routing thresholds
  - Live "estimated monthly cost" recalculates as sliders move

**API Keys panel**:
- Table: [Key name] [Prefix] [Scopes] [Last used] [Expires] [Actions]
- "Create new key" flow — modal with scope checkboxes (read, write, admin), expiration picker, description
- Each key row: copy button, revoke button (red, confirm dialog)

**Billing panel**:
- Arc gauge: tokens used this month vs plan limit. Teal fill, amber warning zone at 80%, red at 95%
- Usage breakdown table: by day, showing queries + tokens + cost per day
- Plan comparison: current plan highlighted, upgrade CTA

---

## COMPONENT LIBRARY (Design System Atoms)

### Buttons
```
Primary:    bg:#00D9C0  text:#080B0F  hover: brightness(1.1)  active: scale(0.97)
Secondary:  bg:transparent  border:#1E2D3D  text:#E8EDF2  hover: bg:#141C24
Danger:     bg:transparent  border:#FF4D6A  text:#FF4D6A  hover: bg:rgba(255,77,106,0.1)
Ghost:      bg:transparent  text:#7A8FA6  hover:text:#E8EDF2  no border
```
All buttons: `border-radius: 8px`, `font-family: IBM Plex Mono`, `font-size: 13px`, `padding: 8px 16px`, `transition: all 150ms`

### Input fields
`background: #0E1318`, `border: 1px solid #1E2D3D`, `border-radius: 8px`, `color: #E8EDF2`
Focus: `border-color: #00D9C0`, `box-shadow: 0 0 0 2px rgba(0,217,192,0.15)`
Placeholder: `#3D5066`

### Status badges / Pills
`border-radius: 4px`, `font-family: IBM Plex Mono`, `font-size: 11px`, `font-weight: 500`, `padding: 3px 8px`
- Indexed: `bg: rgba(0,196,140,0.12)` `color: #00C48C` `border: 1px solid rgba(0,196,140,0.25)`
- Processing: `bg: rgba(255,181,71,0.12)` `color: #FFB547` `border: 1px solid rgba(255,181,71,0.25)` (text pulses opacity 1→0.6→1 at 1.5s)
- Failed: `bg: rgba(255,77,106,0.12)` `color: #FF4D6A` `border: 1px solid rgba(255,77,106,0.25)`

### Cards
`background: #141C24`, `border: 1px solid #1E2D3D`, `border-radius: 12px`, `padding: 20px`
Hover: `border-color: #2A3F55`, `transform: translateY(-1px)`, `transition: all 200ms`

### Skeleton loaders
Animated horizontal shimmer scan line (`background: linear-gradient(90deg, #0E1318 0%, #1E2D3D 50%, #0E1318 100%)`) moving left to right at 1.4s. Used for: chat message loading, document list loading, graph data loading.

### Tooltips
`background: #1E2D3D`, `border: 1px solid #2A3F55`, `border-radius: 6px`, `padding: 6px 10px`, `font-family: IBM Plex Mono`, `font-size: 12px`. No arrow. Appear on delay 400ms, fade in 120ms.

### Agent step indicator (inline, used in chat)
```
● Researcher  ─────  ○ Coder  ─────  ○ Reviewer
   Active                Waiting          Waiting
```
Active = teal fill + teal glow ring animation. Completed = solid teal. Waiting = empty circle, grey stroke.

---

## SPECIAL INTERACTIONS & MICRO-DETAILS

1. **Global search (⌘K)**: Full-screen overlay, `background: rgba(8,11,15,0.95)`, `backdrop-filter: blur(20px)`. Search input at top with teal bottom border glow on focus. Results in 3 sections: "Ask AI" (top — always first), "Documents", "Entities". Recent searches below input when empty. Escape closes.

2. **Graph node hover tooltip**: Appears 120ms after hover. Shows: entity name (DM Serif Display 14px), entity type pill, degree count ("14 connections"), excerpt from source. Dismisses instantly on mouse-leave.

3. **Streaming answer animation**: Characters appear one-by-one but in larger bursts (5-8 chars at a time) at ~40ms intervals — feels fast and intelligent. Teal cursor bar blinks at end of stream. Cursor disappears when stream completes.

4. **Citation reveal**: When a `[1]` citation token streams in, the corresponding Source card in the right panel animates in — slides up 8px, fades from 0 to 1, `duration: 240ms`. The `[1]` superscript also briefly highlights teal then settles.

5. **Model indicator pill** (in top nav): Shows current model in use. `[⚡ Haiku]` in green, `[◆ Sonnet]` in indigo, `[✦ Opus]` in amber. Clicking opens model selector dropdown.

6. **Cost badge** (in top nav): `$12.43 this month` in IBM Plex Mono. On hover: tooltip shows breakdown by model.

7. **Tab transition**: Between left sidebar nav items, content area slides with `translateX(8px) → 0` + fade, `duration: 180ms`. Never a hard cut.

8. **Empty state for chat** (no messages yet):
   - Centered in chat column
   - Large graph node icon (SVG, 64px) in teal
   - `"What would you like to know?"` in DM Serif Display 28px
   - 4 suggested question chips below — pre-written based on documents in the knowledge base
   - Each chip: `border: 1px solid #1E2D3D`, `border-radius: 8px`, clickable, hover: border turns teal

9. **Ingestion success toast**: Slides in from bottom-right. `background: #141C24`, `border-left: 3px solid #00C48C`. Shows: document name + "Indexed — 847 chunks, 234 entities". Auto-dismisses after 5s with progress bar countdown.

10. **Error state** (agent fails after 3 retries): Answer area shows `background: rgba(255,77,106,0.05)`, `border-left: 3px solid #FF4D6A`. Message: "Unable to generate a faithful answer after 3 attempts. Partial context available." with a "Show what was retrieved" expandable.

---

## RESPONSIVE BEHAVIOR

- **≥ 1440px**: Full 3-column layout (sidebar + chat + context panel)
- **1024px–1440px**: Context panel collapses to icon tabs (sources, trace, graph) — clicking opens as overlay panel
- **768px–1024px**: Left sidebar collapses to icon-only (48px). Context panel hidden, accessible via bottom drawer.
- **< 768px** (mobile): Full-screen chat only. Graph explorer = card-based entity browser. Settings = bottom sheets.

---

## ACCESSIBILITY

- All interactive elements: `focus-visible` ring using `box-shadow: 0 0 0 2px #00D9C0`
- Color is never the only differentiator — icons + labels accompany all status colors
- Streaming answer has `aria-live="polite"` region
- Graph explorer has keyboard navigation: Tab through nodes, Enter to select, arrow keys to traverse edges
- All icon buttons have `aria-label`
- Reduced motion: all animations disabled when `prefers-reduced-motion: reduce`

---

## v0-SPECIFIC IMPLEMENTATION NOTES

When building in v0:
- Use `shadcn/ui` as the component base but override all colors with the palette above via CSS variables in `globals.css`
- Install: `@react-sigma/core` for graph, `recharts` for charts, `assistant-ui` for chat, `lucide-react` for icons
- Use `next-themes` but configure for dark-only (no light mode toggle — this is a professional tool)
- All monospaced text: `font-family: 'IBM Plex Mono', monospace` — import from Google Fonts
- Teal glow effect on active elements: `box-shadow: 0 0 0 2px rgba(0,217,192,0.2), 0 0 12px rgba(0,217,192,0.1)`
- For the streaming effect in v0 preview: use `useState` + `useEffect` with `setInterval` to simulate token streaming

---

## FIGMA-SPECIFIC NOTES

When building in Figma:
- Create a `Local Styles` set with all colors above as named styles
- Use `Auto Layout` on every component — no fixed-position elements
- Create components: Button (with variants), Badge (with variants), Card, Input, Sidebar Item, Message Bubble (User/Assistant variants), Citation Card, Agent Step Indicator, Document Row, Metric Card
- Use `Interactive Components` for button hover/active states
- Prototype the chat flow: empty state → typing → streaming (use smart animate between frames) → complete with citations
- Use `variables` (Figma 2024) to define the color tokens — makes dark/light switching instant
- Frame sizes: Desktop 1440×900 (primary), Tablet 1024×768, Mobile 390×844

---

*This prompt encodes the complete Universal Knowledge Hub product — chat, graph explorer, document manager, evaluations, and settings — as a cohesive dark-first scientific instrument UI. Every component, interaction, and motion detail is specified. Build it exactly as described.*