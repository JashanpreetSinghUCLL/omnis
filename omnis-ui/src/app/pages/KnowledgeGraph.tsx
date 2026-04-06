import { useState, useEffect, useRef } from "react";
import { Search, ZoomIn, ZoomOut, Maximize2, Download, Share2, Layers, Shuffle } from "lucide-react";

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

// ── Node Inspector Panel ──────────────────────────────────────────────────────
function NodeInspector({
  node,
  nodes,
  edges,
  onClose,
  onNavigate,
}: {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
  onNavigate: (n: Node) => void;
}) {
  const [activeTab, setActiveTab] = useState<TabType>("Overview");

  useEffect(() => {
    setActiveTab("Overview");
  }, [node.id]);

  const connEdges = edges.filter(e => e.source === node.id || e.target === node.id);
  const connNodes = connEdges
    .map(e => nodes.find(n => n.id === (e.source === node.id ? e.target : e.source)))
    .filter(Boolean) as Node[];

  const outEdges = edges.filter(e => e.source === node.id);
  const inEdges = edges.filter(e => e.target === node.id);
  const relevance = Math.round((node.size / 32) * 100);

  const typeDescriptions: Record<string, string> = {
    Concept:   "A foundational idea forming the theoretical backbone of this knowledge domain.",
    Component: "A structural building block embedded within larger systems and architectures.",
    Process:   "An algorithmic procedure that transforms inputs into meaningful outputs.",
    System:    "A complete integrated architecture combining multiple components and subsystems.",
  };
  const description =
    typeDescriptions[node.type] ??
    "A key entity with multiple interconnected relationships across the knowledge graph.";

  const props = [
    { key: "entity.type",     val: node.type },
    { key: "entity.id",       val: `#${String(node.id).padStart(4, "0")}` },
    { key: "graph.weight",    val: String(node.size) },
    { key: "graph.degree",    val: String(connEdges.length) },
    { key: "index.relevance", val: `${relevance}%` },
    { key: "refs.documents",  val: "2" },
  ];

  const activity = [
    { time: "2h ago", action: "Referenced in", doc: "Deep_Learning_Fundamentals.pdf" },
    { time: "1d ago", action: "Linked from",   doc: "Neural_Architecture_Search.pdf" },
    { time: "3d ago", action: "Indexed from",  doc: "Introduction_to_AI.pdf" },
  ];

  const documents = [
    {
      name: "Introduction_to_AI.pdf",
      page: 12,
      excerpt:
        "Referenced in the context of neural network fundamentals and the mathematical basis of deep learning architectures.",
    },
    {
      name: "Deep_Learning_Fundamentals.pdf",
      page: 45,
      excerpt:
        "Core concept discussed in relation to backpropagation, gradient descent, and loss convergence methods.",
    },
  ];

  const stats = [
    { val: connEdges.length, label: "connections" },
    { val: 2,                label: "documents"   },
    { val: `${relevance}%`,  label: "relevance"   },
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
          <div className="p-5 space-y-6">
            {/* Description */}
            <p
              style={{
                fontSize: "12.5px",
                color: "var(--text-secondary)",
                lineHeight: 1.7,
                borderLeft: `2px solid ${node.color}45`,
                paddingLeft: "12px",
                margin: 0,
              }}
            >
              {description} This node maintains {connEdges.length} active{" "}
              relationship{connEdges.length !== 1 ? "s" : ""} and is referenced across{" "}
              {Math.floor(node.size / 10)} research domains.
            </p>

            {/* Properties table */}
            <div>
              <div
                style={{
                  fontSize: "9.5px",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-tertiary)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: "8px",
                }}
              >
                Entity Properties
              </div>
              <div style={{ borderTop: "1px solid var(--border)" }}>
                {props.map(p => (
                  <div
                    key={p.key}
                    className="flex items-center justify-between py-2"
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "10.5px", color: "var(--text-tertiary)" }}>
                      {p.key}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "10.5px",
                        color: "var(--text-primary)",
                        background: "var(--elevated)",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        border: "1px solid var(--border)",
                      }}
                    >
                      {p.val}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Activity timeline */}
            <div>
              <div
                style={{
                  fontSize: "9.5px",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-tertiary)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: "8px",
                }}
              >
                Recent Activity
              </div>
              <div style={{ borderTop: "1px solid var(--border)" }}>
                {activity.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 py-2.5"
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <div
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: i === 0 ? node.color : "var(--border-hover)",
                        marginTop: "4px",
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                        {a.action}{" "}
                        <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{a.doc}</span>
                      </div>
                      <div
                        style={{
                          fontSize: "10px",
                          fontFamily: "var(--font-mono)",
                          color: "var(--text-tertiary)",
                          marginTop: "2px",
                        }}
                      >
                        {a.time}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
                    <span
                      style={{
                        fontSize: "9.5px",
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-tertiary)",
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                      }}
                    >
                      {dir}
                    </span>
                    <span
                      style={{
                        fontSize: "9px",
                        fontFamily: "var(--font-mono)",
                        color: node.color,
                        background: `${node.color}14`,
                        padding: "1px 6px",
                        borderRadius: "10px",
                      }}
                    >
                      {dirEdges.length}
                    </span>
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
                            <div
                              style={{
                                fontSize: "12px",
                                fontWeight: 500,
                                color: "var(--text-primary)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {rel.label}
                            </div>
                            <div
                              style={{
                                fontSize: "9.5px",
                                fontFamily: "var(--font-mono)",
                                color: "var(--text-tertiary)",
                                marginTop: "1px",
                              }}
                            >
                              {rel.type}
                            </div>
                          </div>

                          <div
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: "11px",
                              color: rel.color,
                              opacity: 0.7,
                              flexShrink: 0,
                            }}
                          >
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
            {documents.map((doc, i) => (
              <div
                key={i}
                style={{
                  borderRadius: "10px",
                  overflow: "hidden",
                  border: "1px solid var(--border)",
                  background: "var(--elevated)",
                }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}
                >
                  <div className="flex items-center gap-2.5" style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "6px",
                        background: `${node.color}14`,
                        border: `1px solid ${node.color}30`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
                        <path d="M1 1h6.5L10 3.5V12H1V1z" stroke={node.color} strokeWidth="0.9" fill="none" />
                        <path d="M7 1v3h3" stroke={node.color} strokeWidth="0.9" fill="none" />
                        <path d="M3 6.5h5M3 8.5h3.5" stroke={node.color} strokeWidth="0.75" strokeLinecap="round" />
                      </svg>
                    </div>
                    <span
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 500,
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {doc.name}
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "10px",
                      color: node.color,
                      background: `${node.color}14`,
                      padding: "2px 8px",
                      borderRadius: "4px",
                      flexShrink: 0,
                      marginLeft: "8px",
                    }}
                  >
                    p.{doc.page}
                  </span>
                </div>

                <div className="px-4 py-3">
                  <p
                    style={{
                      fontSize: "11.5px",
                      color: "var(--text-tertiary)",
                      lineHeight: 1.65,
                      margin: 0,
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical" as const,
                      overflow: "hidden",
                    }}
                  >
                    {doc.excerpt}
                  </p>
                  <button
                    className="mt-2.5 transition-opacity"
                    style={{
                      fontSize: "11px",
                      fontFamily: "var(--font-mono)",
                      color: node.color,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      opacity: 0.75,
                    }}
                    onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.opacity = "1")}
                    onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.opacity = "0.75")}
                  >
                    View in Documents →
                  </button>
                </div>
              </div>
            ))}
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
        >
          Copy ID
        </button>

        <button
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [activeFilter, setActiveFilter] = useState("All");
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [colors, setColors] = useState<ReturnType<typeof getThemeColors> | null>(null);

  // ── Node-drag physics refs ─────────────────────────────────────────────────
  const draggingNodeIdRef  = useRef<string | null>(null);
  const isDraggingNodeRef  = useRef(false);          // true once mouse actually moved
  const mouseVelRef        = useRef({ x: 0, y: 0 }); // px/frame velocity
  const lastMouseWorldRef  = useRef({ x: 0, y: 0 });
  const throwFrameRef      = useRef<number | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null); // for visual

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

  useEffect(() => {
    const centerX = 600;
    const centerY = 400;

    const sampleNodes: Node[] = [
      { id: "1",  label: "Neural Networks",      x: centerX,       y: centerY - 100, size: 32, color: "#00D9C0", type: "Concept"   },
      { id: "2",  label: "Deep Learning",         x: centerX - 200, y: centerY,       size: 28, color: "#6B7FFF", type: "Concept"   },
      { id: "3",  label: "Backpropagation",       x: centerX + 200, y: centerY,       size: 24, color: "#FFB547", type: "Process"   },
      { id: "4",  label: "Activation Functions",  x: centerX - 150, y: centerY + 150, size: 22, color: "#00D9C0", type: "Component" },
      { id: "5",  label: "Gradient Descent",      x: centerX + 150, y: centerY + 150, size: 22, color: "#FFB547", type: "Process"   },
      { id: "6",  label: "CNN",                   x: centerX - 300, y: centerY - 50,  size: 20, color: "#6B7FFF", type: "System"    },
      { id: "7",  label: "RNN",                   x: centerX - 250, y: centerY + 200, size: 20, color: "#6B7FFF", type: "System"    },
      { id: "8",  label: "Transformer",           x: centerX + 100, y: centerY + 250, size: 26, color: "#6B7FFF", type: "System"    },
      { id: "9",  label: "Attention",             x: centerX + 280, y: centerY + 200, size: 24, color: "#00D9C0", type: "Component" },
      { id: "10", label: "Loss Function",         x: centerX + 120, y: centerY - 180, size: 20, color: "#FFB547", type: "Process"   },
      { id: "11", label: "Optimizer",             x: centerX + 300, y: centerY + 50,  size: 18, color: "#FFB547", type: "Process"   },
      { id: "12", label: "LSTM",                  x: centerX - 350, y: centerY + 100, size: 18, color: "#6B7FFF", type: "System"    },
    ];

    const sampleEdges: Edge[] = [
      { source: "1",  target: "2"  },
      { source: "1",  target: "3"  },
      { source: "1",  target: "10" },
      { source: "2",  target: "4"  },
      { source: "2",  target: "6"  },
      { source: "2",  target: "7"  },
      { source: "2",  target: "8"  },
      { source: "3",  target: "5"  },
      { source: "8",  target: "9"  },
      { source: "4",  target: "7"  },
      { source: "7",  target: "12" },
      { source: "5",  target: "11" },
      { source: "9",  target: "11" },
    ];

    setNodes(sampleNodes);
    setEdges(sampleEdges);
  }, []);

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

    edges.forEach(edge => {
      const sourceNode = nodes.find(n => n.id === edge.source);
      const targetNode = nodes.find(n => n.id === edge.target);
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
      }
    });

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    nodes.forEach(node => {
      const isSelected = selectedNode?.id === node.id;
      const isHovered  = hoveredNode?.id  === node.id;
      const isGrabbed  = draggingNodeId   === node.id;

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
        nodes.forEach(other => {
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
      ctx.globalAlpha = isSelected || isHovered || isGrabbed ? (isGrabbed ? 0.3 : 0.2) : 0.1;
      ctx.fill();
      ctx.globalAlpha = 1;

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

      if (zoom >= 0.8 || isHovered || isSelected) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = isHovered || isSelected ? colors.textPrimary : colors.textSecondary;
        ctx.font = `600 ${isHovered || isSelected ? "13px" : "12px"} Inter, sans-serif`;
        ctx.textAlign = "center";

        if (isHovered || isSelected) {
          ctx.shadowBlur = 4;
          ctx.shadowColor = colors.isDark ? "rgba(0, 0, 0, 0.5)" : "rgba(255, 255, 255, 0.8)";
        }

        ctx.fillText(node.label, node.x, node.y + node.size / 2 + 20);
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
  }, [nodes, edges, zoom, pan, selectedNode, hoveredNode, colors, draggingNodeId]);

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
    setNodes(prev => {
      const pos = prev.map(n => ({ ...n }));
      for (let iter = 0; iter < 250; iter++) {
        // Node-node repulsion
        for (let i = 0; i < pos.length; i++) {
          for (let j = i + 1; j < pos.length; j++) {
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
        // Edge spring attraction
        edges.forEach(edge => {
          const s = pos.find(n => n.id === edge.source);
          const t = pos.find(n => n.id === edge.target);
          if (!s || !t) return;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const f = (dist - 200) * 0.012;
          s.x += (dx / dist) * f;
          s.y += (dy / dist) * f;
          t.x -= (dx / dist) * f;
          t.y -= (dy / dist) * f;
        });
      }
      return pos;
    });
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

    const clicked = nodes.find(n =>
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
    const hovered = nodes.find(n =>
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
        const clicked = nodes.find(n =>
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

  const filters = ["All", "Concept", "Component", "Process", "System"];

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Toolbar */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-border bg-surface/50 backdrop-blur-sm">
        <div className="flex items-center gap-4 flex-1">
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" size={16} />
            <input
              type="text"
              placeholder="Search entities..."
              className="w-full h-10 pl-10 pr-4 rounded-lg bg-elevated border border-border text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-teal/50 transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            {filters.map(filter => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className="px-3 h-9 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: activeFilter === filter ? "var(--accent-teal)" : "transparent",
                  color: activeFilter === filter ? "#FFFFFF" : "var(--text-secondary)",
                  border: activeFilter === filter ? "none" : "1px solid var(--border)",
                  fontWeight: activeFilter === filter ? 600 : 500,
                  boxShadow: activeFilter === filter ? "0 2px 8px rgba(0, 217, 192, 0.3)" : "none",
                }}
                onMouseEnter={e => {
                  if (activeFilter !== filter) {
                    e.currentTarget.style.color = "var(--text-primary)";
                    e.currentTarget.style.borderColor = "var(--border-hover)";
                  }
                }}
                onMouseLeave={e => {
                  if (activeFilter !== filter) {
                    e.currentTarget.style.color = "var(--text-secondary)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }
                }}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleZoomOut} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all" title="Zoom out">
            <ZoomOut size={18} />
          </button>
          <button onClick={handleZoomIn} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all" title="Zoom in">
            <ZoomIn size={18} />
          </button>
          <button onClick={handleResetView} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all" title="Reset view">
            <Maximize2 size={18} />
          </button>
          <div className="w-px h-6 bg-border mx-1" />
          <button className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all"><Layers size={18} /></button>
          <button className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all"><Download size={18} /></button>
          <button className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all"><Share2 size={18} /></button>
          <button onClick={handleForceLayout} className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-elevated transition-all" title="Auto-arrange nodes (force layout)"><Shuffle size={18} /></button>
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

        {/* Stats overlay */}
        <div className="absolute top-4 left-4 px-4 py-3 rounded-lg bg-elevated/90 backdrop-blur-sm border border-border shadow-lg">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-xs text-text-tertiary mb-1">Nodes</div>
              <div className="text-lg font-semibold text-text-primary">{nodes.length}</div>
            </div>
            <div className="w-px h-10 bg-border" />
            <div>
              <div className="text-xs text-text-tertiary mb-1">Connections</div>
              <div className="text-lg font-semibold text-text-primary">{edges.length}</div>
            </div>
          </div>
        </div>

        {/* Node Inspector */}
        {selectedNode && (
          <NodeInspector
            node={selectedNode}
            nodes={nodes}
            edges={edges}
            onClose={() => setSelectedNode(null)}
            onNavigate={setSelectedNode}
          />
        )}
      </div>
    </div>
  );
}