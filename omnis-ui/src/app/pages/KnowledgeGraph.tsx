import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router";
import { Search, ZoomIn, ZoomOut, Maximize2, Download, Share2, Layers, Shuffle, RefreshCw, ChevronDown, Check } from "lucide-react";
import { streamGraphExplore, type ApiGraphNode, type ApiGraphEdge } from "../lib/graphStream";
import { useUpload } from "../context/UploadContext";
import { getApiBaseUrl } from "../lib/api";

// ── Source / excerpt helpers ──────────────────────────────────────────────────

/** Strip internal ingestion prefixes (e.g. omnis_ingest_abc123_) and use the
 *  user-visible document name when we can match one. */
function cleanSourceName(
  source: string,
  docs: Array<{ name: string }>,
): string {
  // Try to match against a known doc by exact name or stem
  const match = docs.find(
    (d) =>
      source === d.name ||
      source.includes(d.name) ||
      d.name.includes(source.replace(/\.[^.]+$/, "")),
  );
  if (match) return match.name;
  // New ingestions store the original filename — return as-is.
  return source;
}

/** Strip <!-- Page N --> HTML-comment markers and normalise whitespace. */
function cleanExcerpt(text: string): string {
  return text
    .replace(/<!--\s*Page\s*\d+\s*-->/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Entity-type → canvas color mapping
const ENTITY_COLORS: Record<string, string> = {
  // ── Actual pipeline entity types (graph_builder.py) ──────────────────────
  Technology: "#00D9C0",
  Concept:    "#6B7FFF",
  API:        "#FFB547",
  Function:   "#FF4D6A",
  Module:     "#9B8AFF",
  // ── Extras / legacy ───────────────────────────────────────────────────────
  Process:      "#FFB547",
  Component:    "#FF4D6A",
  System:       "#00D9C0",
  Person:       "#6B7FFF",
  Organization: "#FFB547",
  Document:     "#9B8AFF",
  Unknown:      "#888888",
};

function entityColor(type: string): string {
  return (
    ENTITY_COLORS[type] ??
    `hsl(${type.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360}, 60%, 60%)`
  );
}

function layoutNodes(apiNodes: ApiGraphNode[], containerW = 1200, containerH = 800): Node[] {
  const total = apiNodes.length;
  const cx = containerW / 2;
  const cy = containerH / 2;
  const pad = 60;

  return apiNodes.map((n, i) => {
    // Use server coordinates if available
    if (n.x != null && n.y != null) {
      return {
        id: n.id, label: n.label,
        x: n.x, y: n.y,
        size: Math.max(10, Math.min(44, 10 + Math.log1p(n.degree) * 7)),
        color: entityColor(n.entity_type),
        type: n.entity_type,
      };
    }

    // Multi-ring layout: outer 60 % on outer ring, middle 30 % on mid ring,
    // top 10 % (high-degree hubs) clustered near center — all pre-spread so
    // the force layout never starts from a tight cluster.
    const tier = i / total;
    let r: number;
    if (tier < 0.1) {
      r = Math.min(containerW, containerH) * 0.10;      // hub ring
    } else if (tier < 0.4) {
      r = Math.min(containerW, containerH) * 0.28;      // mid ring
    } else {
      // outer nodes: use multiple concentric rings every 100 px
      const outerIdx = i - Math.floor(total * 0.4);
      const outerTotal = total - Math.floor(total * 0.4);
      const ringCount = Math.max(1, Math.floor((Math.min(containerW, containerH) * 0.5 - 100) / 100));
      const ringIdx = Math.floor((outerIdx / outerTotal) * ringCount);
      r = Math.min(containerW, containerH) * 0.45 + ringIdx * 90;
    }
    // Clamp so nodes don't leave the canvas
    r = Math.min(r, Math.min(containerW / 2 - pad, containerH / 2 - pad));
    const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
    return {
      id: n.id, label: n.label,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      size: Math.max(12, Math.min(32, 12 + Math.log1p(n.degree) * 5)),
      color: entityColor(n.entity_type),
      type: n.entity_type,
    };
  });
}

function applyForceLayout(
  inputNodes: Node[],
  inputEdges: Edge[],
  containerW = 1200,
  containerH = 800,
): Node[] {
  const n = inputNodes.length;
  if (n === 0) return inputNodes;

  // Scale iterations down for large graphs so the main thread doesn't block
  const iters = Math.max(40, Math.round(200 * Math.min(1, 60 / n)));

  // Build an index so edge lookups are O(1)
  const idx = new Map(inputNodes.map((node, i) => [node.id, i]));
  const pos = inputNodes.map(node => ({ ...node }));

  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j].x - pos[i].x || 0.01;
        const dy = pos[j].y - pos[i].y || 0.01;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const f = 7500 / (dist * dist);
        pos[i].x -= (dx / dist) * f;
        pos[i].y -= (dy / dist) * f;
        pos[j].x += (dx / dist) * f;
        pos[j].y += (dy / dist) * f;
      }
    }
    for (const edge of inputEdges) {
      const si = idx.get(edge.source);
      const ti = idx.get(edge.target);
      if (si == null || ti == null) continue;
      const s = pos[si], t = pos[ti];
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = (dist - 200) * 0.012;
      s.x += (dx / dist) * f;
      s.y += (dy / dist) * f;
      t.x -= (dx / dist) * f;
      t.y -= (dy / dist) * f;
    }
  }

  // Normalize all positions back into the viewport so nodes never fly off-screen
  const pad = 80;
  const xs = pos.map(p => p.x);
  const ys = pos.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scaleX = (containerW - pad * 2) / rangeX;
  const scaleY = (containerH - pad * 2) / rangeY;
  const scale = Math.min(scaleX, scaleY);
  const offX = pad + ((containerW - pad * 2) - rangeX * scale) / 2;
  const offY = pad + ((containerH - pad * 2) - rangeY * scale) / 2;

  return pos.map(p => ({
    ...p,
    x: offX + (p.x - minX) * scale,
    y: offY + (p.y - minY) * scale,
  }));
}

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  type: string;
}

interface Edge {
  source: string;
  target: string;
  relation?: string;    // Neo4j relationship type, e.g. DEPENDS_ON, USES, CALLS
}

type TabType = "Overview" | "Connections" | "Sources";

// ── Orbital Mini-Map ──────────────────────────────────────────────────────────
function OrbitalMiniMap({ node, connNodes }: { node: Node; connNodes: Node[] }) {
  const cx = 148, cy = 96;
  const orbitR = 66;
  const innerR = 38;
  const sats = connNodes.slice(0, 8);
  const n = sats.length;

  return (
    <svg viewBox="0 0 380 192" className="absolute inset-0 w-full h-full" style={{ overflow: "visible" }}>
      <defs>
        <radialGradient id={`halo-${node.id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={node.color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={node.color} stopOpacity="0" />
        </radialGradient>
        <filter id={`glow-${node.id}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer halo */}
      <circle cx={cx} cy={cy} r="52" fill={`url(#halo-${node.id})`} className="animate-orbital-pulse" />

      {/* Orbit rings */}
      <circle cx={cx} cy={cy} r={orbitR} fill="none" stroke={node.color} strokeWidth="0.6" strokeDasharray="5 9" opacity="0.3" />
      <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="white" strokeWidth="0.4" opacity="0.06" />

      {/* Connecting spokes */}
      {sats.map((sat, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const sx = cx + Math.cos(angle) * orbitR;
        const sy = cy + Math.sin(angle) * orbitR;
        return (
          <line
            key={sat.id}
            x1={cx} y1={cy} x2={sx} y2={sy}
            stroke={sat.color} strokeWidth="0.75" opacity="0.45"
            strokeDasharray="3 6"
          />
        );
      })}

      {/* Center glow */}
      <circle cx={cx} cy={cy} r="22" fill={node.color} opacity="0.10" />

      {/* Center node */}
      <circle cx={cx} cy={cy} r="15" fill="var(--elevated)" stroke={node.color} strokeWidth="2" filter={`url(#glow-${node.id})`} />
      <circle cx={cx} cy={cy} r="5.5" fill={node.color} />

      {/* Satellite nodes */}
      {sats.map((sat, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const sx = cx + Math.cos(angle) * orbitR;
        const sy = cy + Math.sin(angle) * orbitR;
        return (
          <g key={sat.id}>
            <circle cx={sx} cy={sy} r="9" fill="var(--elevated)" stroke={sat.color} strokeWidth="1.5" opacity="0.9" />
            <circle cx={sx} cy={sy} r="3" fill={sat.color} />
          </g>
        );
      })}

      {/* Connection count label */}
      <text
        x="372" y="184"
        textAnchor="end"
        fill="white" opacity="0.18"
        fontSize="8.5"
        fontFamily="JetBrains Mono, monospace"
        letterSpacing="0.04em"
      >
        {n} direct connection{n !== 1 ? "s" : ""}
      </text>
    </svg>
  );
}

// ── Node detail types (from /v1/graph/node/{id}/detail) ──────────────────────
interface NodeDetail {
  description: string;
  out_degree: number;
  in_degree: number;
  out_relations: string[];
  in_relations: string[];
  properties: Record<string, string | number | boolean>;
}

// ── Node Inspector Panel ──────────────────────────────────────────────────────
function NodeInspector({
  node,
  nodes,
  edges,
  onClose,
  onNavigate,
  indexedDocs,
  onAsk,
}: {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
  onNavigate: (n: Node) => void;
  indexedDocs: Array<{ name: string }>;
  onAsk: (label: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<TabType>("Overview");
  const [nodeSources, setNodeSources] = useState<Array<{ source: string; pages: string[]; excerpts: string[] }>>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [nodeDetail, setNodeDetail] = useState<NodeDetail | null>(null);

  useEffect(() => {
    setActiveTab("Overview");
    setNodeSources([]);
    setNodeDetail(null);
    setSourcesLoading(true);

    const base = getApiBaseUrl();
    // Fetch both detail and sources in parallel
    Promise.all([
      fetch(`${base}/v1/graph/node/${node.id}/detail`).then(r => r.json()),
      fetch(`${base}/v1/graph/node/${node.id}/sources`).then(r => r.json()),
    ]).then(([detail, sourcesData]) => {
      setNodeDetail(detail as NodeDetail);
      setNodeSources((sourcesData as { sources?: Array<{ source: string; pages: string[]; excerpts: string[] }> }).sources ?? []);
    }).catch(() => {
      setNodeDetail(null);
      setNodeSources([]);
    }).finally(() => setSourcesLoading(false));
  }, [node.id]);

  const connEdges = edges.filter(e => e.source === node.id || e.target === node.id);
  const connNodes = connEdges
    .map(e => nodes.find(n => n.id === (e.source === node.id ? e.target : e.source)))
    .filter(Boolean) as Node[];

  const outEdges = edges.filter(e => e.source === node.id);
  const inEdges  = edges.filter(e => e.target === node.id);

  // Use real degree from Neo4j (detail) when available, fall back to loaded subgraph degree
  const totalDegree = nodeDetail
    ? nodeDetail.out_degree + nodeDetail.in_degree
    : connEdges.length;

  const props = [
    { key: "TYPE",      val: node.type },
    { key: "OUTBOUND",  val: nodeDetail ? String(nodeDetail.out_degree) : String(outEdges.length) },
    { key: "INBOUND",   val: nodeDetail ? String(nodeDetail.in_degree)  : String(inEdges.length)  },
    { key: "DOCUMENTS", val: sourcesLoading ? "…" : String(nodeSources.length) },
    { key: "DEGREE",    val: String(totalDegree) },
  ];

  const stats = [
    { val: totalDegree,                                              label: "degree"    },
    { val: sourcesLoading ? "…" : nodeSources.length,               label: "documents" },
    { val: nodeDetail ? nodeDetail.out_relations.length + nodeDetail.in_relations.length : "…", label: "rel. types" },
  ];

  const tabs: TabType[] = ["Overview", "Connections", "Sources"];

  return (
    <div
      key={node.id}
      className="absolute top-0 right-0 h-full flex flex-col animate-slide-in-right"
      style={{
        width: "380px",
        zIndex: 10,
        background: "var(--surface)",
        borderLeft: `1px solid ${node.color}30`,
        boxShadow: `-24px 0 64px rgba(0,0,0,0.22), -1px 0 0 ${node.color}18`,
      }}
    >
      {/* ── Orbital Header ── */}
      <div className="relative flex-shrink-0 overflow-hidden" style={{ height: "192px" }}>
        {/* Dark gradient backdrop */}
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 55% 75% at 39% 55%, ${node.color}1E 0%, transparent 75%), var(--background)`,
          }}
        />

        {/* Dot-grid texture */}
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
          <defs>
            <pattern id={`dots-${node.id}`} x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="11" cy="11" r="0.9" fill="white" opacity="0.045" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#dots-${node.id})`} />
        </svg>

        {/* Orbital visualization */}
        <OrbitalMiniMap node={node} connNodes={connNodes} />

        {/* Type badge — top-left */}
        <div className="absolute top-4 left-5">
          <span
            style={{
              fontSize: "9.5px",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              padding: "3px 9px",
              borderRadius: "4px",
              background: `${node.color}1A`,
              color: node.color,
              border: `1px solid ${node.color}38`,
            }}
          >
            {node.type}
          </span>
        </div>

        {/* Close — top-right */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg transition-all"
          style={{
            background: "var(--elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-tertiary)",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.background = "var(--surface)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.background = "var(--elevated)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text-tertiary)";
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {/* Thin colored bottom border */}
        <div
          className="absolute bottom-0 left-0 right-0 h-px"
          style={{ background: `linear-gradient(to right, ${node.color}55, transparent 80%)` }}
        />
      </div>

      {/* ── Identity ── */}
      <div
        className="px-5 pt-4 pb-3.5 flex-shrink-0"
        style={{ borderBottom: `1px solid ${node.color}14` }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.22rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            letterSpacing: "-0.025em",
            lineHeight: 1.2,
          }}
        >
          {node.label}
        </h2>
        <div className="flex items-center gap-2.5 mt-1.5">
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-tertiary)", letterSpacing: "0.05em" }}>
            #{String(node.id).padStart(4, "0")}
          </span>
          <span style={{ color: "var(--border-hover)", fontSize: "10px" }}>·</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {node.type}
          </span>
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div className="flex flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="flex-1 px-5 py-3"
            style={{ borderLeft: i > 0 ? "1px solid var(--border)" : "none" }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "1.28rem",
                fontWeight: 700,
                color: node.color,
                letterSpacing: "-0.025em",
                lineHeight: 1,
              }}
            >
              {s.val}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "9px",
                color: "var(--text-tertiary)",
                marginTop: "3px",
                letterSpacing: "0.07em",
                textTransform: "uppercase",
              }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="flex flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        {tabs.map(tab => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex-1 py-2.5 relative transition-colors"
              style={{
                background: "none",
                border: "none",
                color: active ? node.color : "var(--text-tertiary)",
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {tab}
              {active && (
                <span
                  className="absolute bottom-0 left-1/2 -translate-x-1/2"
                  style={{
                    width: "36px",
                    height: "2px",
                    background: node.color,
                    borderRadius: "2px 2px 0 0",
                    display: "block",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto">

        {/* OVERVIEW */}
        {activeTab === "Overview" && (
          <div className="p-5 space-y-5">
            {/* Description — from Neo4j if available, otherwise synthesised */}
            <div style={{ borderRadius: "8px", padding: "12px 14px", background: `${node.color}0D`, border: `1px solid ${node.color}28` }}>
              {sourcesLoading ? (
                <p style={{ fontSize: "12.5px", color: "var(--text-tertiary)", lineHeight: 1.7, margin: 0, fontFamily: "var(--font-mono)" }}>Loading…</p>
              ) : nodeDetail?.description ? (
                <p style={{ fontSize: "12.5px", color: "var(--text-secondary)", lineHeight: 1.75, margin: 0 }}>
                  {nodeDetail.description}
                </p>
              ) : (
                <p style={{ fontSize: "12.5px", color: "var(--text-secondary)", lineHeight: 1.75, margin: 0 }}>
                  <span style={{ color: node.color, fontWeight: 600 }}>{node.label}</span>
                  {" "}is a <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{node.type}</span> with{" "}
                  <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{totalDegree} relationship{totalDegree !== 1 ? "s" : ""}</span>
                  {!sourcesLoading && nodeSources.length > 0 && (
                    <>, referenced in <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{nodeSources.length} document{nodeSources.length !== 1 ? "s" : ""}</span></>
                  )}.
                </p>
              )}
            </div>

            {/* Properties table — real degree from Neo4j, no fake centrality */}
            <div>
              <div style={{ fontSize: "9.5px", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>
                Properties
              </div>
              <div style={{ borderTop: "1px solid var(--border)" }}>
                {props.map(p => (
                  <div key={p.key} className="flex items-center justify-between py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "10.5px", color: "var(--text-tertiary)", letterSpacing: "0.06em" }}>{p.key}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "10.5px", color: "var(--text-primary)", background: "var(--elevated)", padding: "2px 8px", borderRadius: "4px", border: "1px solid var(--border)" }}>{p.val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Relationship types from Neo4j */}
            {nodeDetail && (nodeDetail.out_relations.length > 0 || nodeDetail.in_relations.length > 0) && (
              <div>
                <div style={{ fontSize: "9.5px", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>
                  Relationship Types
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {[...new Set([...nodeDetail.out_relations, ...nodeDetail.in_relations])].map(r => (
                    <span key={r} style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: node.color, background: `${node.color}14`, padding: "2px 8px", borderRadius: "4px", border: `1px solid ${node.color}28`, letterSpacing: "0.04em" }}>
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Top connections (from loaded subgraph) */}
            {connNodes.length > 0 && (
              <div>
                <div style={{ fontSize: "9.5px", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>
                  Neighbours in View
                </div>
                <div className="space-y-1.5">
                  {connNodes.slice(0, 6).map(cn => {
                    const edgeToNode = connEdges.find(e => (e.source === node.id && e.target === cn.id) || (e.target === node.id && e.source === cn.id));
                    return (
                      <button key={cn.id} onClick={() => onNavigate(cn)} className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all" style={{ background: "var(--elevated)", border: "1px solid var(--border)", cursor: "pointer" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = cn.color + "60"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; }}
                      >
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: cn.color, flexShrink: 0 }} />
                        <span style={{ fontSize: "12px", color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cn.label}</span>
                        {edgeToNode?.relation && (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-tertiary)", flexShrink: 0, background: "var(--surface)", padding: "1px 5px", borderRadius: "3px" }}>
                            {edgeToNode.relation}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* CONNECTIONS */}
        {activeTab === "Connections" && (
          <div className="p-5 space-y-6">
            {(["Outbound", "Inbound"] as const).map(dir => {
              const dirEdges = dir === "Outbound" ? outEdges : inEdges;
              if (dirEdges.length === 0) return null;
              return (
                <div key={dir}>
                  <div className="flex items-center gap-2 mb-3">
                    <span style={{ fontSize: "9.5px", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      {dir}
                    </span>
                    <span style={{ fontSize: "9px", fontFamily: "var(--font-mono)", color: node.color, background: `${node.color}14`, padding: "1px 6px", borderRadius: "10px" }}>
                      {dirEdges.length}
                    </span>
                    {nodeDetail && dir === "Outbound" && nodeDetail.out_degree > dirEdges.length && (
                      <span style={{ fontSize: "9px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                        ({nodeDetail.out_degree} in KB)
                      </span>
                    )}
                    {nodeDetail && dir === "Inbound" && nodeDetail.in_degree > dirEdges.length && (
                      <span style={{ fontSize: "9px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                        ({nodeDetail.in_degree} in KB)
                      </span>
                    )}
                    <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
                  </div>

                  <div className="space-y-1.5">
                    {dirEdges.map((edge, i) => {
                      const nid = dir === "Outbound" ? edge.target : edge.source;
                      const rel = nodes.find(n => n.id === nid);
                      if (!rel) return null;
                      return (
                        <button
                          key={i}
                          onClick={() => onNavigate(rel)}
                          className="w-full text-left transition-all"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "11px",
                            padding: "9px 11px",
                            borderRadius: "8px",
                            background: "var(--elevated)",
                            border: "1px solid var(--border)",
                            borderLeft: `3px solid ${rel.color}`,
                            cursor: "pointer",
                          }}
                          onMouseEnter={e => {
                            const el = e.currentTarget as HTMLButtonElement;
                            el.style.background = "var(--background)";
                            el.style.borderColor = `${rel.color}60`;
                            el.style.borderLeftColor = rel.color;
                          }}
                          onMouseLeave={e => {
                            const el = e.currentTarget as HTMLButtonElement;
                            el.style.background = "var(--elevated)";
                            el.style.borderColor = "var(--border)";
                            el.style.borderLeftColor = rel.color;
                          }}
                        >
                          <div
                            style={{
                              width: "26px",
                              height: "26px",
                              borderRadius: "6px",
                              background: `${rel.color}14`,
                              border: `1px solid ${rel.color}38`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: rel.color }} />
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {rel.label}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "3px" }}>
                              <span style={{ fontSize: "9.5px", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                                {rel.type}
                              </span>
                              {edge.relation && (
                                <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: node.color, background: `${node.color}14`, padding: "1px 5px", borderRadius: "3px", border: `1px solid ${node.color}25`, letterSpacing: "0.03em" }}>
                                  {edge.relation}
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: rel.color, opacity: 0.7, flexShrink: 0 }}>
                            {dir === "Outbound" ? "→" : "←"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* SOURCES */}
        {activeTab === "Sources" && (
          <div className="p-5 space-y-3">
            {sourcesLoading ? (
              <div className="py-8 text-center" style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                Loading sources…
              </div>
            ) : nodeSources.length === 0 ? (
              <div className="py-8 text-center" style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                No sources found for this entity.
              </div>
            ) : nodeSources.map((doc) => {
              const friendlyName = cleanSourceName(doc.source, indexedDocs);
              const allPages = doc.pages.filter(Boolean);
              const cleanedExcerpts = doc.excerpts.map(cleanExcerpt).filter(Boolean);
              return (
                <div
                  key={doc.source}
                  style={{ borderRadius: "10px", overflow: "hidden", border: "1px solid var(--border)", background: "var(--elevated)" }}
                >
                  {/* Header */}
                  <div
                    className="flex items-start gap-3 px-4 py-3"
                    style={{ background: "var(--surface)", borderBottom: cleanedExcerpts.length > 0 ? "1px solid var(--border)" : "none" }}
                  >
                    <div
                      style={{
                        width: "28px", height: "28px", borderRadius: "6px",
                        background: `${node.color}14`, border: `1px solid ${node.color}30`,
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "1px",
                      }}
                    >
                      <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
                        <path d="M1 1h6.5L10 3.5V12H1V1z" stroke={node.color} strokeWidth="0.9" fill="none" />
                        <path d="M7 1v3h3" stroke={node.color} strokeWidth="0.9" fill="none" />
                        <path d="M3 6.5h5M3 8.5h3.5" stroke={node.color} strokeWidth="0.75" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {friendlyName}
                      </div>
                      {allPages.length > 0 && (
                        <div style={{ marginTop: "4px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                          {allPages.map((pg) => (
                            <span
                              key={pg}
                              style={{
                                fontFamily: "var(--font-mono)", fontSize: "9.5px",
                                color: node.color, background: `${node.color}14`,
                                padding: "1px 6px", borderRadius: "4px",
                              }}
                            >
                              p.{pg}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Excerpts */}
                  {cleanedExcerpts.length > 0 && (
                    <div className="px-4 py-3 space-y-2">
                      {cleanedExcerpts.slice(0, 3).map((excerpt, ei) => (
                        <p
                          key={ei}
                          style={{
                            fontSize: "11.5px", color: "var(--text-secondary)", lineHeight: 1.65,
                            margin: 0, paddingLeft: "10px", borderLeft: `2px solid ${node.color}35`,
                          }}
                        >
                          {excerpt.length > 220 ? excerpt.slice(0, 220) + "…" : excerpt}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div
        className="flex-shrink-0 px-4 py-3.5 flex gap-2.5"
        style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}
      >
        <button
          className="transition-all"
          style={{
            flex: 1,
            padding: "9px 0",
            borderRadius: "8px",
            background: "var(--elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            fontSize: "12px",
            fontWeight: 500,
            cursor: "pointer",
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.borderColor = node.color;
            el.style.color = node.color;
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.borderColor = "var(--border)";
            el.style.color = "var(--text-secondary)";
          }}
          onClick={() => navigator.clipboard.writeText(node.label)}
        >
          Copy name
        </button>

        <button
          onClick={() => onAsk(node.label)}
          className="transition-all flex items-center justify-center gap-2"
          style={{
            flex: 2,
            padding: "9px 0",
            borderRadius: "8px",
            background: node.color,
            border: "none",
            color: "#000",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: `0 4px 18px ${node.color}3A`,
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.transform = "translateY(-1px)";
            el.style.boxShadow = `0 6px 22px ${node.color}55`;
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.transform = "translateY(0)";
            el.style.boxShadow = `0 4px 18px ${node.color}3A`;
          }}
        >
          Ask about this
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 5.5h8M5.5 1.5l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function KnowledgeGraph() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [activeFilter, setActiveFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [colors, setColors] = useState<ReturnType<typeof getThemeColors> | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [nodeLimit, setNodeLimit] = useState<number>(75);
  const NODE_LIMIT_OPTIONS = [25, 50, 75, 100, 200, 500, 2000] as const;
  // Real Neo4j document source names (may differ from UploadContext display names)
  const [neo4jSources, setNeo4jSources] = useState<string[]>([]);
  // KB-wide stats from Neo4j — used to show "X of Y total" in the overlay
  const [kbStats, setKbStats] = useState<{ total_entities: number; total_relations: number; total_documents: number } | null>(null);
  const { documents } = useUpload();
  const indexedDocs = documents.filter((d) => d.status === "indexed");

  // ── Node-drag physics refs ─────────────────────────────────────────────────
  const draggingNodeIdRef  = useRef<string | null>(null);
  const isDraggingNodeRef  = useRef(false);          // true once mouse actually moved
  const mouseVelRef        = useRef({ x: 0, y: 0 }); // px/frame velocity
  const lastMouseWorldRef  = useRef({ x: 0, y: 0 });
  const throwFrameRef      = useRef<number | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null); // for visual

  const displayNodes = useMemo(() => {
    let result = nodes;
    if (activeFilter !== "All") {
      result = result.filter(n => n.type === activeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(n => n.label.toLowerCase().includes(q));
    }
    return result;
  }, [nodes, activeFilter, searchQuery]);

  const displayEdges = useMemo(() => {
    const nodeIds = new Set(displayNodes.map(n => n.id));
    return edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }, [edges, displayNodes]);

  const getThemeColors = () => {
    const root = document.documentElement;
    const isDark = root.classList.contains("dark");
    return {
      background: getComputedStyle(root).getPropertyValue("--background").trim(),
      border: getComputedStyle(root).getPropertyValue("--border").trim(),
      textPrimary: getComputedStyle(root).getPropertyValue("--text-primary").trim(),
      textSecondary: getComputedStyle(root).getPropertyValue("--text-secondary").trim(),
      accentTeal: getComputedStyle(root).getPropertyValue("--accent-teal").trim(),
      surface: getComputedStyle(root).getPropertyValue("--surface").trim(),
      elevated: getComputedStyle(root).getPropertyValue("--elevated").trim(),
      isDark,
    };
  };

  useEffect(() => {
    setColors(getThemeColors());

    const observer = new MutationObserver(() => {
      setColors(getThemeColors());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // ── Load Neo4j metadata (sources + KB-wide stats) on mount / refresh ─────────
  useEffect(() => {
    const base = getApiBaseUrl();
    Promise.all([
      fetch(`${base}/v1/graph/sources`).then(r => r.json()),
      fetch(`${base}/v1/graph/stats`).then(r => r.json()),
    ]).then(([srcData, statsData]) => {
      setNeo4jSources((srcData as { sources?: string[] }).sources ?? []);
      setKbStats(statsData as { total_entities: number; total_relations: number; total_documents: number });
    }).catch(() => {/* non-fatal */});
  }, [refreshKey]);

  // ── Load graph data ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setNodes([]);
    setEdges([]);

    async function loadGraph() {
      const apiNodes: ApiGraphNode[] = [];
      const apiEdges: ApiGraphEdge[] = [];

      try {
        for await (const event of streamGraphExplore({ limit: Math.min(nodeLimit, 2000), source: selectedSource ?? undefined })) {
          if (cancelled) return;
          if (event.type === "node") {
            apiNodes.push(event);
          } else if (event.type === "edge") {
            apiEdges.push(event);
          } else if (event.type === "done") {
            const container = containerRef.current;
            const w = container?.offsetWidth ?? 1200;
            const h = container?.offsetHeight ?? 800;
            const sorted = [...apiNodes].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0)).slice(0, nodeLimit);
            const topIds = new Set(sorted.map(n => n.id));
            const trimmedEdges = apiEdges
              .filter(e => topIds.has(e.source) && topIds.has(e.target))
              .map(e => ({ source: e.source, target: e.target, relation: e.relation }));
            const layouted = layoutNodes(sorted, w, h);
            const positioned = applyForceLayout(layouted, trimmedEdges, w, h);
            if (!cancelled) {
              setNodes(positioned);
              setEdges(trimmedEdges);
              // Auto-fit: reset zoom/pan so the freshly loaded graph fills the view
              setZoom(1);
              setPan({ x: 0, y: 0 });
              setIsLoading(false);
            }
          }
        }
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadGraph();
    return () => { cancelled = true; };
  }, [refreshKey, selectedSource, nodeLimit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !colors) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // ── 1. Screen-space radial gradient background ──────────────────────────
    const bgGrad = ctx.createRadialGradient(
      rect.width * 0.5,  rect.height * 0.42, 0,
      rect.width * 0.5,  rect.height * 0.5,  Math.max(rect.width, rect.height) * 0.82
    );
    if (colors.isDark) {
      bgGrad.addColorStop(0,   "#0D1A26");
      bgGrad.addColorStop(0.6, "#090E15");
      bgGrad.addColorStop(1,   "#050810");
    } else {
      bgGrad.addColorStop(0,   "#FFFFFF");
      bgGrad.addColorStop(0.6, "#FFFFFF");
      bgGrad.addColorStop(1,   "#FAFAFA");
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // ── 2. Ambient glow blobs (world-space, near node clusters) ─────────────
    const ambientBlobs = [
      { x: 580, y: 310, r: 300, rgb: colors.isDark ? "0,217,192"   : "0,184,169",   peak: colors.isDark ? 0.07 : 0.06  },
      { x: 390, y: 430, r: 260, rgb: colors.isDark ? "107,127,255" : "91,111,255",  peak: colors.isDark ? 0.06 : 0.05 },
      { x: 740, y: 210, r: 220, rgb: colors.isDark ? "255,181,71"  : "245,158,11",  peak: colors.isDark ? 0.05 : 0.055  },
    ];
    ctx.globalAlpha = 1;
    ambientBlobs.forEach(blob => {
      const g = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.r);
      g.addColorStop(0,    `rgba(${blob.rgb},${blob.peak})`);
      g.addColorStop(0.45, `rgba(${blob.rgb},${blob.peak * 0.3})`);
      g.addColorStop(1,    `rgba(${blob.rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(blob.x, blob.y, blob.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── 3. Dot grid (world-space — pans & stays 1 px on-screen) ─────────────
    const gridStep = 36;
    const dotR     = 1.15 / zoom;
    const gLeft  = Math.floor((-pan.x / zoom) / gridStep - 1) * gridStep;
    const gTop   = Math.floor((-pan.y / zoom) / gridStep - 1) * gridStep;
    const gRight  = (-pan.x + rect.width)  / zoom + gridStep;
    const gBottom = (-pan.y + rect.height) / zoom + gridStep;

    ctx.fillStyle  = colors.isDark ? "rgba(48, 82, 130, 0.55)" : "rgba(180, 180, 180, 0.55)";
    ctx.globalAlpha = 1;
    for (let wx = gLeft; wx <= gRight; wx += gridStep) {
      for (let wy = gTop; wy <= gBottom; wy += gridStep) {
        ctx.beginPath();
        ctx.arc(wx, wy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Pre-compute which nodes are connected to the selected node (for focus dimming)
    const selectedNeighborIds = selectedNode
      ? new Set(
          displayEdges
            .filter(e => e.source === selectedNode.id || e.target === selectedNode.id)
            .flatMap(e => [e.source, e.target])
        )
      : null;

    // ── LOD: pre-compute degree map for label gating ─────────────────────────
    const degreeMap = new Map<string, number>();
    displayEdges.forEach(e => {
      degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
    });
    const sortedDegrees = [...degreeMap.values()].sort((a, b) => a - b);
    // Top 15% of nodes by degree get labels at normal zoom
    const p85Degree = sortedDegrees[Math.floor(sortedDegrees.length * 0.85)] ?? 1;

    displayEdges.forEach(edge => {
      const sourceNode = displayNodes.find(n => n.id === edge.source);
      const targetNode = displayNodes.find(n => n.id === edge.target);
      if (sourceNode && targetNode) {
        const isConnectedToHovered =
          hoveredNode && (sourceNode.id === hoveredNode.id || targetNode.id === hoveredNode.id);
        const isConnectedToSelected =
          selectedNode && (sourceNode.id === selectedNode.id || targetNode.id === selectedNode.id);

        const gradient = ctx.createLinearGradient(sourceNode.x, sourceNode.y, targetNode.x, targetNode.y);

        if (isConnectedToHovered || isConnectedToSelected) {
          gradient.addColorStop(0, sourceNode.color);
          gradient.addColorStop(1, targetNode.color);
          ctx.strokeStyle = gradient;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 2.5;
          ctx.shadowBlur = 8;
          ctx.shadowColor = colors.accentTeal;
        } else {
          const edgeColor = colors.isDark ? "rgba(123, 143, 166, 0.4)" : "rgba(100, 120, 145, 0.35)";
          ctx.strokeStyle = edgeColor;
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1.5;
          ctx.shadowBlur = 0;
        }

        ctx.beginPath();
        ctx.moveTo(sourceNode.x, sourceNode.y);
        ctx.lineTo(targetNode.x, targetNode.y);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw relationship label at edge midpoint when edge is active
        if ((isConnectedToHovered || isConnectedToSelected) && edge.relation && zoom >= 0.7) {
          const mx = (sourceNode.x + targetNode.x) / 2;
          const my = (sourceNode.y + targetNode.y) / 2;
          const label = edge.relation;
          const fontSize = Math.max(9, Math.round(11 / zoom));
          ctx.font = `500 ${fontSize}px "JetBrains Mono", monospace`;
          const tw = ctx.measureText(label).width;
          const pad = 5;
          // pill background
          ctx.globalAlpha = 0.88;
          ctx.fillStyle = colors.isDark ? "#0D1520" : "#FFFFFF";
          const rr = fontSize * 0.6;
          ctx.beginPath();
          ctx.roundRect(mx - tw / 2 - pad, my - fontSize * 0.75, tw + pad * 2, fontSize * 1.5, rr);
          ctx.fill();
          // label text
          ctx.globalAlpha = 1;
          ctx.fillStyle = colors.isDark ? "#00D9C0" : "#007A70";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, mx, my);
          ctx.textBaseline = "alphabetic";
        }
      }
    });

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    displayNodes.forEach(node => {
      const isSelected = selectedNode?.id === node.id;
      const isHovered  = hoveredNode?.id  === node.id;
      const isGrabbed  = draggingNodeId   === node.id;
      // Dim nodes not connected to the selected node (focus mode)
      const isFaded = selectedNeighborIds !== null && !selectedNeighborIds.has(node.id);
      const nodeAlpha = isFaded ? 0.12 : 1;

      // ── Grabbed outer ring (dashed) ──────────────────────────────────────
      if (isGrabbed) {
        ctx.save();
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.size / 2 + 22, 0, Math.PI * 2);
        ctx.strokeStyle = node.color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Proximity snap lines to nearby nodes
        displayNodes.forEach(other => {
          if (other.id === node.id) return;
          const dx = other.x - node.x;
          const dy = other.y - node.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 160) {
            const alpha = (1 - dist / 160) * 0.65;
            ctx.save();
            ctx.setLineDash([4, 7]);
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = node.color;
            ctx.lineWidth = 1.2 / zoom;
            ctx.shadowBlur = 6;
            ctx.shadowColor = node.color;
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(other.x, other.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
            ctx.restore();
          }
        });
      }

      // ── Outer halo ───────────────────────────────────────────────────────
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size / 2 + (isGrabbed ? 18 : 12), 0, Math.PI * 2);
      ctx.fillStyle = isSelected || isHovered || isGrabbed ? colors.accentTeal : node.color;
      ctx.globalAlpha = nodeAlpha * (isSelected || isHovered || isGrabbed ? (isGrabbed ? 0.3 : 0.2) : 0.1);
      ctx.fill();
      ctx.globalAlpha = nodeAlpha;

      const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.size / 2);
      if (colors.isDark) {
        gradient.addColorStop(0, colors.elevated);
        gradient.addColorStop(1, colors.surface);
      } else {
        gradient.addColorStop(0, "#FFFFFF");
        gradient.addColorStop(1, colors.surface);
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      if (isSelected || isHovered) {
        ctx.shadowBlur = 12;
        ctx.shadowColor = node.color;
      }
      ctx.strokeStyle = node.color;
      ctx.lineWidth = isSelected || isHovered ? 4 : 3;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(node.x, node.y, isSelected || isHovered ? node.size / 5 : node.size / 6, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();

      // ── LOD label gating ─────────────────────────────────────────────────
      const nodeDegree = degreeMap.get(node.id) ?? 0;
      const isHighDegree = nodeDegree >= p85Degree && nodeDegree >= 2;
      // Show label if: hovered/selected/grabbed, OR high-degree at reasonable zoom,
      // OR extreme zoom-in (show everything)
      const shouldShowLabel =
        isHovered || isSelected || isGrabbed ||
        (isHighDegree && zoom >= 0.55) ||
        zoom >= 2.0;

      if (shouldShowLabel) {
        const labelY = node.y + node.size / 2 + 18;
        const labelText = node.label.length > 24 ? node.label.slice(0, 22) + "…" : node.label;
        const fontSize = isHovered || isSelected ? 13 : 11;
        ctx.font = `600 ${fontSize}px Inter, sans-serif`;
        const textWidth = ctx.measureText(labelText).width;

        // ── Pill background so label is always readable ────────────────────
        const padX = 5, padY = 3;
        ctx.globalAlpha = nodeAlpha * (isHovered || isSelected ? 0.92 : 0.78);
        ctx.fillStyle = colors.isDark ? "rgba(13,21,32,0.88)" : "rgba(255,255,255,0.9)";
        const rr2 = 5;
        ctx.beginPath();
        ctx.roundRect(node.x - textWidth / 2 - padX, labelY - fontSize - padY, textWidth + padX * 2, fontSize + padY * 2, rr2);
        ctx.fill();

        // ── Label text ────────────────────────────────────────────────────
        ctx.globalAlpha = nodeAlpha;
        ctx.fillStyle = isHovered || isSelected ? colors.textPrimary : colors.textSecondary;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";

        if (isHovered || isSelected) {
          ctx.shadowBlur = 4;
          ctx.shadowColor = colors.isDark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.9)";
        }
        ctx.fillText(labelText, node.x, labelY);
        ctx.shadowBlur = 0;
      }
    });

    ctx.restore();

    // ── 4. Screen-space vignette overlay ────────────────────────────────────
    const vignette = ctx.createRadialGradient(
      rect.width * 0.5, rect.height * 0.5, Math.min(rect.width, rect.height) * 0.35,
      rect.width * 0.5, rect.height * 0.5, Math.max(rect.width, rect.height) * 0.78
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, colors.isDark ? "rgba(0,0,0,0.38)" : "rgba(220,220,220,0.15)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, rect.width, rect.height);

    const handleResize = () => {
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx?.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [displayNodes, displayEdges, zoom, pan, selectedNode, hoveredNode, colors, draggingNodeId]);

  // ── Throw physics after node release ────────────────────────────────────────
  const startThrow = (nodeId: string) => {
    let vx = mouseVelRef.current.x * 5;
    let vy = mouseVelRef.current.y * 5;

    const tick = () => {
      vx *= 0.88;
      vy *= 0.88;
      if (Math.abs(vx) < 0.15 && Math.abs(vy) < 0.15) {
        setDraggingNodeId(null);
        return;
      }
      setNodes(prev => prev.map(n =>
        n.id === nodeId ? { ...n, x: n.x + vx, y: n.y + vy } : n
      ));
      throwFrameRef.current = requestAnimationFrame(tick);
    };
    throwFrameRef.current = requestAnimationFrame(tick);
  };

  // ── Force-directed auto-layout ───────────────────────────────────────────────
  const handleForceLayout = () => {
    const w = containerRef.current?.offsetWidth ?? 1200;
    const h = containerRef.current?.offsetHeight ?? 800;
    const positioned = applyForceLayout(displayNodes, displayEdges, w, h);
    const posMap = new Map(positioned.map(n => [n.id, { x: n.x, y: n.y }]));
    setNodes(prev => prev.map(n => {
      const pos = posMap.get(n.id);
      return pos ? { ...n, ...pos } : n;
    }));
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (throwFrameRef.current) {
      cancelAnimationFrame(throwFrameRef.current);
      throwFrameRef.current = null;
    }

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;

    const clicked = displayNodes.find(n =>
      Math.sqrt((n.x - x) ** 2 + (n.y - y) ** 2) < n.size / 2
    );

    if (clicked) {
      // Start node drag
      draggingNodeIdRef.current = clicked.id;
      isDraggingNodeRef.current = false;
      mouseVelRef.current = { x: 0, y: 0 };
      lastMouseWorldRef.current = { x, y };
      canvas.style.cursor = "grabbing";
    } else {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left - pan.x) / zoom;
    const wy = (e.clientY - rect.top  - pan.y) / zoom;

    // ── Node being dragged ─────────────────────────────────────────────────
    if (draggingNodeIdRef.current) {
      const dx = wx - lastMouseWorldRef.current.x;
      const dy = wy - lastMouseWorldRef.current.y;
      mouseVelRef.current = { x: dx, y: dy };
      lastMouseWorldRef.current = { x: wx, y: wy };
      isDraggingNodeRef.current = true;

      const nodeId = draggingNodeIdRef.current;
      setNodes(prev => prev.map(n =>
        n.id === nodeId ? { ...n, x: wx, y: wy } : n
      ));
      setDraggingNodeId(nodeId);
      canvas.style.cursor = "grabbing";
      return;
    }

    // ── Canvas pan ─────────────────────────────────────────────────────────
    if (isDragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
      return;
    }

    // ── Hover detection ────────────────────────────────────────────────────
    const hovered = displayNodes.find(n =>
      Math.sqrt((n.x - wx) ** 2 + (n.y - wy) ** 2) < n.size / 2
    );
    setHoveredNode(hovered || null);
    canvas.style.cursor = hovered ? "grab" : "grab";
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggingNodeIdRef.current) {
      const nodeId = draggingNodeIdRef.current;
      const wasDragged = isDraggingNodeRef.current;

      draggingNodeIdRef.current = null;
      isDraggingNodeRef.current = false;

      if (!wasDragged) {
        // It was a tap/click on the node → select it
        const rect = canvasRef.current!.getBoundingClientRect();
        const x = (e.clientX - rect.left - pan.x) / zoom;
        const y = (e.clientY - rect.top  - pan.y) / zoom;
        const clicked = displayNodes.find(n =>
          Math.sqrt((n.x - x) ** 2 + (n.y - y) ** 2) < n.size / 2 + 5
        );
        setSelectedNode(clicked || null);
        setDraggingNodeId(null);
      } else {
        // Launch throw animation
        startThrow(nodeId);
      }
      if (canvasRef.current) canvasRef.current.style.cursor = "grab";
      return;
    }
    setIsDragging(false);
  };

  const handleCanvasMouseLeave = () => {
    if (draggingNodeIdRef.current) {
      startThrow(draggingNodeIdRef.current);
      draggingNodeIdRef.current = null;
      isDraggingNodeRef.current = false;
    }
    setIsDragging(false);
    setHoveredNode(null);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => Math.max(0.5, Math.min(3, prev + delta)));
  };

  const handleZoomIn  = () => setZoom(prev => Math.min(prev + 0.2, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.2, 0.5));
  const handleResetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Navigate to Chat with the entity name pre-filled as a question
  const handleAsk = (label: string) => {
    navigate(`/?q=${encodeURIComponent(`Tell me about ${label}`)}`);
  };

  // ── Dynamic entity-type filters from loaded nodes ───────────────────────────
  const entityTypes = useMemo(() => {
    const types = [...new Set(nodes.map((n) => n.type))].sort();
    return ["All", ...types];
  }, [nodes]);

  // ── Download, Share, Fullscreen ───────────────────────────────────────────
  const [shareToast, setShareToast] = useState(false);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `knowledge-graph-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // fallback: prompt
    }
    setShareToast(true);
    setTimeout(() => setShareToast(false), 2000);
  };

  const handleFullscreen = () => {
    const el = containerRef.current?.parentElement as HTMLElement | null;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Toolbar — position:relative + high z-index so dropdowns render above canvas */}
      <div
        className="h-16 flex items-center justify-between px-6 border-b border-border bg-surface/50 backdrop-blur-sm"
        style={{ position: "relative", zIndex: 100 }}
      >
        <div className="flex items-center gap-3 flex-1" style={{ minWidth: 0 }}>
          {/* Search */}
          <div className="relative w-72 flex-shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" size={16} />
            <input
              type="text"
              placeholder="Search entities..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-elevated border border-border text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-teal/50 transition-all text-sm"
            />
          </div>

          {/* Document source picker — uses actual Neo4j source names so the filter matches */}
          {neo4jSources.length > 0 && (
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setSourcePickerOpen((o) => !o)}
                className="flex items-center gap-2 h-9 px-3 rounded-lg border transition-colors"
                style={{
                  background: selectedSource ? "rgba(0,217,192,0.1)" : "var(--elevated)",
                  border: selectedSource ? "1px solid var(--accent-teal)" : "1px solid var(--border)",
                  color: selectedSource ? "var(--accent-teal)" : "var(--text-secondary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11.5px",
                  maxWidth: "200px",
                  cursor: "pointer",
                }}
              >
                <span className="truncate">
                  {selectedSource ? cleanSourceName(selectedSource, indexedDocs) : "All documents"}
                </span>
                <ChevronDown size={12} className="flex-shrink-0" />
              </button>
              {sourcePickerOpen && (
                <div
                  className="absolute top-full mt-1 left-0 rounded-lg shadow-xl overflow-hidden"
                  style={{
                    background: "var(--elevated)",
                    border: "1px solid var(--border)",
                    minWidth: "240px",
                    zIndex: 200,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
                  }}
                >
                  <button
                    className="w-full text-left px-3 py-2.5 text-[12px] transition-colors hover:bg-surface"
                    style={{ fontFamily: "var(--font-mono)", color: !selectedSource ? "var(--accent-teal)" : "var(--text-primary)", cursor: "pointer" }}
                    onClick={() => { setSelectedSource(null); setSourcePickerOpen(false); }}
                  >
                    All documents
                  </button>
                  {neo4jSources.map((src) => (
                    <button
                      key={src}
                      className="w-full text-left px-3 py-2.5 text-[12px] transition-colors hover:bg-surface"
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: selectedSource === src ? "var(--accent-teal)" : "var(--text-primary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block",
                        cursor: "pointer",
                      }}
                      onClick={() => { setSelectedSource(src); setSourcePickerOpen(false); }}
                    >
                      {cleanSourceName(src, indexedDocs)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Node limit picker */}
          <div className="relative flex-shrink-0">
            <select
              value={nodeLimit}
              onChange={e => setNodeLimit(Number(e.target.value))}
              title="Max nodes to display"
              style={{
                height: "36px",
                paddingLeft: "10px",
                paddingRight: "28px",
                borderRadius: "8px",
                background: "var(--elevated)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
                fontSize: "11.5px",
                cursor: "pointer",
                appearance: "none",
                WebkitAppearance: "none",
              }}
            >
              {NODE_LIMIT_OPTIONS.map(n => (
                <option key={n} value={n}>{n === 2000 ? "All" : `${n} nodes`}</option>
              ))}
            </select>
            <ChevronDown size={11} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-tertiary)" }} />
          </div>

          {/* Entity type filters — derived from loaded nodes, horizontally scrollable */}
          <div
            className="flex items-center gap-1.5"
            style={{ overflowX: "auto", overflowY: "visible", scrollbarWidth: "none", flexShrink: 1, minWidth: 0 }}
          >
            {entityTypes.map(filter => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className="px-3 h-8 rounded-lg text-xs font-medium transition-all flex-shrink-0"
                style={{
                  background: activeFilter === filter ? "var(--accent-teal)" : "transparent",
                  color: activeFilter === filter ? "#FFFFFF" : "var(--text-secondary)",
                  border: activeFilter === filter ? "none" : "1px solid var(--border)",
                  fontWeight: activeFilter === filter ? 600 : 500,
                  boxShadow: activeFilter === filter ? "0 2px 8px rgba(0, 217, 192, 0.3)" : "none",
                  cursor: "pointer",
                }}
                onMouseEnter={e => { if (activeFilter !== filter) { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.borderColor = "var(--border-hover)"; } }}
                onMouseLeave={e => { if (activeFilter !== filter) { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.borderColor = "var(--border)"; } }}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {/* Right-side controls */}
        <div className="flex items-center gap-1 flex-shrink-0 ml-3">
          <button onClick={handleZoomOut} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all" title="Zoom out"><ZoomOut size={17} /></button>
          <button onClick={handleZoomIn} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all" title="Zoom in"><ZoomIn size={17} /></button>
          <button onClick={handleResetView} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all" title="Fit to screen"><Maximize2 size={17} /></button>
          <div className="w-px h-6 bg-border mx-1" />
          <button onClick={handleFullscreen} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all" title="Toggle fullscreen"><Layers size={17} /></button>
          <button onClick={handleDownload} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all" title="Download as PNG"><Download size={17} /></button>
          <button
            onClick={handleShare}
            className="p-2 rounded-lg transition-all"
            title="Copy link"
            style={{ color: shareToast ? "var(--accent-teal)" : "var(--text-secondary)" }}
          >
            {shareToast ? <Check size={17} /> : <Share2 size={17} />}
          </button>
          <div className="w-px h-6 bg-border mx-1" />
          <button onClick={handleForceLayout} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all" title="Auto-arrange (force layout)"><Shuffle size={17} /></button>
          <button onClick={() => setRefreshKey((k) => k + 1)} className={`p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all ${isLoading ? "animate-spin" : ""}`} title="Refresh graph"><RefreshCw size={17} /></button>
        </div>
      </div>

      {/* Graph Canvas */}
      <div className="flex-1 relative" ref={containerRef}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseLeave}
          onWheel={handleWheel}
          className="w-full h-full cursor-grab"
        />

        {/* Zoom indicator */}
        <div className="absolute bottom-4 left-4 px-3 py-2 rounded-lg bg-elevated/90 backdrop-blur-sm border border-border shadow-lg">
          <div className="text-xs font-mono text-text-secondary">Zoom: {Math.round(zoom * 100)}%</div>
        </div>

        {/* Stats overlay — all figures sourced from Neo4j */}
        <div className="absolute top-4 left-4 px-4 py-3 rounded-lg bg-elevated/90 backdrop-blur-sm border border-border shadow-lg">
          <div className="flex items-center gap-5">
            {/* Entities: showing X of Y KB-total */}
            <div>
              <div className="text-xs text-text-tertiary mb-1" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Entities</div>
              <div className="text-lg font-semibold text-text-primary" style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.02em" }}>
                {displayNodes.length}
                {kbStats && (
                  <span className="text-xs font-normal text-text-tertiary ml-1.5">
                    / {kbStats.total_entities.toLocaleString()} total
                  </span>
                )}
              </div>
            </div>
            <div className="w-px h-9 bg-border" />
            {/* Relationships */}
            <div>
              <div className="text-xs text-text-tertiary mb-1" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Relations</div>
              <div className="text-lg font-semibold text-text-primary" style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.02em" }}>
                {displayEdges.length}
                {kbStats && (
                  <span className="text-xs font-normal text-text-tertiary ml-1.5">
                    / {kbStats.total_relations.toLocaleString()} total
                  </span>
                )}
              </div>
            </div>
            {kbStats && (
              <>
                <div className="w-px h-9 bg-border" />
                {/* Documents */}
                <div>
                  <div className="text-xs text-text-tertiary mb-1" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Documents</div>
                  <div className="text-lg font-semibold text-text-primary" style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.02em" }}>
                    {kbStats.total_documents}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Density warning */}
        {!isLoading && displayNodes.length > 200 && (
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] pointer-events-none"
            style={{
              background: "rgba(255, 180, 0, 0.1)",
              border: "1px solid rgba(255, 180, 0, 0.35)",
              color: "rgba(255, 180, 0, 0.9)",
              fontFamily: "var(--font-mono)",
              backdropFilter: "blur(8px)",
              zIndex: 10,
            }}
          >
            <span style={{ fontSize: 14 }}>⚠</span>
            {displayNodes.length} nodes — filter by document or entity type for clarity
          </div>
        )}

        {/* Empty state */}
        {!isLoading && nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <div className="text-[14px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>No graph data yet</div>
            <div className="text-[12px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>Ingest a document to see entities here</div>
            <button
              className="mt-3 px-4 py-2 rounded-lg text-[12px] pointer-events-auto"
              style={{ background: "var(--accent-teal)", color: "#fff", fontFamily: "var(--font-mono)" }}
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              Refresh
            </button>
          </div>
        )}

        {/* Node Inspector */}
        {selectedNode && (
          <NodeInspector
            node={selectedNode}
            nodes={nodes}
            edges={edges}
            onClose={() => setSelectedNode(null)}
            onNavigate={setSelectedNode}
            indexedDocs={indexedDocs}
            onAsk={handleAsk}
          />
        )}
      </div>
    </div>
  );
}