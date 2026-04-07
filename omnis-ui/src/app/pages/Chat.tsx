import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router";
import {
  Send, Paperclip, ChevronDown, Square, ChevronRight, ChevronLeft, Check,
  FileText, FileCode, Globe, File, Loader2, Network, ExternalLink,
} from "lucide-react";
import { streamAsk, type AskStreamEvent } from "../lib/askStream";
import { streamGraphExplore, type ApiGraphNode, type ApiGraphEdge } from "../lib/graphStream";
import { getSessionId } from "../lib/api";
import { MarkdownMessage } from "../components/MarkdownMessage";

interface Citation {
  id: number;
  title: string;
  text: string;
  relevance: number;
  chunk_id?: string | null;
}

interface MiniNode {
  id: string;
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  type: string;
}

interface MiniEdge {
  source: string;
  target: string;
  relation?: string;
}

interface TraceStep {
  node: string;
  status: "active" | "completed";
  data?: Record<string, unknown>;
  startTs?: number;
  durationMs?: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  traceSteps?: TraceStep[];
  latency_ms?: number;
  model_used?: string;
  faithfulness_score?: number | null;
  fromCache?: boolean;
}

const NODE_LABELS: Record<string, string> = {
  classifier: "Classifier",
  researcher: "Researcher",
  coder: "Coder",
  reviewer: "Reviewer",
  degradation: "Fallback",
};

// Pipeline order for trace timeline
const PIPELINE_ORDER = ["classifier", "researcher", "coder", "reviewer", "degradation"];

const ENTITY_COLORS: Record<string, string> = {
  Technology: "#00D9C0", Concept: "#6B7FFF", API: "#FFB547",
  Function: "#FF4D6A", Module: "#9B8AFF", System: "#00D9C0",
  Person: "#6B7FFF", Organization: "#FFB547", Document: "#9B8AFF",
};

function entityColor(type: string): string {
  return ENTITY_COLORS[type] ??
    `hsl(${type.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360}, 55%, 60%)`;
}

function fileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return <FileText size={12} style={{ color: "var(--accent-amber)", flexShrink: 0 }} />;
  if (["py", "js", "ts", "tsx", "jsx", "go", "rs"].includes(ext))
    return <FileCode size={12} style={{ color: "var(--accent-indigo)", flexShrink: 0 }} />;
  if (["html", "htm"].includes(ext))
    return <Globe size={12} style={{ color: "var(--accent-teal)", flexShrink: 0 }} />;
  return <File size={12} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />;
}

function shortName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** Detect temp ingestion filenames like `omnis_ingest_v73yw0an.pdf` and return
 *  a human-readable fallback. Real filenames pass through unchanged. */
function displaySourceName(source: string): string {
  const base = shortName(source);
  // Pattern: omnis_ingest_ + alphanumeric hash + extension
  if (/^omnis_ingest_[a-z0-9]+\.[a-z0-9]+$/i.test(base)) {
    const ext = base.split(".").pop()?.toUpperCase() ?? "FILE";
    return `Untitled ${ext}`;
  }
  return base;
}

/** Normalise citation relevance scores so the top source = 100%.
 *  This prevents everything showing as 3% when absolute reranker scores are low. */
function normalisedRelevance(citations: Citation[]): Map<number, number> {
  const max = Math.max(...citations.map((c) => c.relevance), 1);
  return new Map(citations.map((c) => [c.id, Math.round((c.relevance / max) * 100)]));
}

const MODELS = [
  { id: null,                 label: "Auto",   desc: "Classifier picks" },
  { id: "claude-haiku-3-5",  label: "Haiku",  desc: "Fast · cheap" },
  { id: "claude-sonnet-4",   label: "Sonnet", desc: "Balanced" },
  { id: "claude-opus-4",     label: "Opus",   desc: "Best quality" },
] as const;

type ModelId = typeof MODELS[number]["id"];

export default function Chat() {
  const [searchParams] = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(searchParams.get("q") ?? "");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeNodes, setActiveNodes] = useState<TraceStep[]>([]);
  const [currentCitations, setCurrentCitations] = useState<Citation[]>([]);
  const [currentTab, setCurrentTab] = useState<"sources" | "trace" | "graph">("sources");
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [uploadToast, setUploadToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [miniGraphNodes, setMiniGraphNodes] = useState<MiniNode[]>([]);
  const [miniGraphEdges, setMiniGraphEdges] = useState<MiniEdge[]>([]);
  const [miniGraphLoading, setMiniGraphLoading] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingTextRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const miniGraphAbortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => { scrollToBottom(); }, [messages, streamingText]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const close = () => setModelMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [modelMenuOpen]);

  const loadMiniGraph = useCallback(async (source: string) => {
    miniGraphAbortRef.current?.abort();
    const ctrl = new AbortController();
    miniGraphAbortRef.current = ctrl;
    setMiniGraphLoading(true);
    setMiniGraphNodes([]);
    setMiniGraphEdges([]);

    const rawNodes: ApiGraphNode[] = [];
    const rawEdges: ApiGraphEdge[] = [];
    try {
      for await (const ev of streamGraphExplore({ source, limit: 30 })) {
        if (ctrl.signal.aborted) break;
        if (ev.type === "node") rawNodes.push(ev);
        else if (ev.type === "edge") rawEdges.push(ev);
        else if (ev.type === "done") break;
      }
    } catch { /* abort or network error */ }

    // Radial layout — no heavy force simulation for a sidebar
    const total = rawNodes.length;
    const CX = 160, CY = 110;
    const laid: MiniNode[] = rawNodes.map((n, i) => {
      const tier = i / Math.max(total, 1);
      const r = tier < 0.15 ? 28 : tier < 0.5 ? 68 : 105 + (i % 3) * 20;
      const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
      return {
        id: n.id, label: n.label,
        x: CX + Math.cos(angle) * r,
        y: CY + Math.sin(angle) * r,
        size: Math.max(6, Math.min(18, 6 + Math.log1p(n.degree) * 3.5)),
        color: entityColor(n.entity_type),
        type: n.entity_type,
      };
    });

    setMiniGraphNodes(laid);
    setMiniGraphEdges(rawEdges.map(e => ({ source: e.source, target: e.target, relation: e.relation })));
    setMiniGraphLoading(false);
  }, []);

  // Load mini graph whenever the graph tab becomes active and we have citations
  useEffect(() => {
    if (currentTab !== "graph") return;
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    const citations = isStreaming ? currentCitations : (last?.citations ?? []);
    if (!citations.length) return;
    loadMiniGraph(citations[0].title);
  }, [currentTab, isStreaming, currentCitations, messages, loadMiniGraph]);

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    if (!file) return;

    setUploadToast({ text: `Uploading ${file.name}…`, ok: true });
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/v1/ingest`, { method: "POST", body: form });
      const data = await res.json();
      if (data.skipped) {
        setUploadToast({ text: `${file.name} already ingested`, ok: true });
      } else {
        setUploadToast({ text: `${file.name} queued for ingestion`, ok: true });
      }
    } catch {
      setUploadToast({ text: `Upload failed`, ok: false });
    }
    setTimeout(() => setUploadToast(null), 4000);
  };

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const question = input.trim();
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: question,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);
    setStreamingText("");
    streamingTextRef.current = "";
    setActiveNodes([]);
    setCurrentCitations([]);

    const abort = new AbortController();
    abortRef.current = abort;

    const pendingCitations: Citation[] = [];
    const pendingTrace: Map<string, TraceStep> = new Map();
    let finalAnswer = "";
    let modelUsed = "";
    let faithfulness: number | null = null;
    let latency = 0;
    let fromCache = false;

    try {
      await streamAsk(
        { question, session_id: getSessionId(), model: selectedModel },
        (event: AskStreamEvent) => {
          if (event.type === "tool_start") {
            const step: TraceStep = {
              node: event.node,
              status: "active",
              startTs: event.ts,
            };
            pendingTrace.set(event.node, step);
            setActiveNodes(Array.from(pendingTrace.values()));
          } else if (event.type === "tool_result") {
            const step = pendingTrace.get(event.node);
            if (step) {
              step.status = "completed";
              step.data = event.data;
              step.durationMs = step.startTs
                ? Math.round((event.ts - step.startTs) * 1000)
                : undefined;
              pendingTrace.set(event.node, step);
              setActiveNodes(Array.from(pendingTrace.values()));
            }
          } else if (event.type === "delta") {
            streamingTextRef.current += event.content;
            setStreamingText(streamingTextRef.current);
          } else if (event.type === "citation") {
            pendingCitations.push({
              id: event.index,
              title: event.source,
              text: event.text ?? "",
              relevance: event.score != null ? Math.round(event.score * 100) : 70,
              chunk_id: event.chunk_id,
            });
            setCurrentCitations([...pendingCitations]);
          } else if (event.type === "cache_hit") {
            fromCache = true;
          } else if (event.type === "final") {
            finalAnswer = event.answer;
            modelUsed = event.model_used;
            faithfulness = event.faithfulness_score ?? null;
            latency = event.latency_ms;
          } else if (event.type === "error") {
            finalAnswer = `Error: ${event.detail}`;
          }
        },
        abort.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("Ask stream failed:", err);
        finalAnswer = "Something went wrong. Is the API running?";
      }
    }

    const answer = finalAnswer || streamingTextRef.current || "No answer generated.";

    setIsStreaming(false);
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "assistant",
        content: answer,
        citations: pendingCitations,
        traceSteps: Array.from(pendingTrace.values()),
        latency_ms: latency,
        model_used: modelUsed,
        faithfulness_score: faithfulness,
        fromCache,
      },
    ]);
    setStreamingText("");
    streamingTextRef.current = "";
    setActiveNodes([]);
    setCurrentCitations([]);
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  const suggestedQuestions = [
    "What are the key principles of RAG systems?",
    "Explain how knowledge graphs improve retrieval",
    "How does multi-hop reasoning work?",
    "Best practices for document chunking strategies",
  ];

  return (
    <div className="h-full flex">
      {/* Chat Column */}
      <div className="flex-1 flex flex-col relative">
        <div className="flex-1 overflow-y-auto px-12">
          <div className="max-w-[720px] mx-auto py-8">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none" className="mb-6">
                  <circle cx="32" cy="16" r="6" fill="var(--accent-teal)" opacity="0.8" />
                  <circle cx="16" cy="44" r="6" fill="var(--accent-teal)" opacity="0.8" />
                  <circle cx="48" cy="44" r="6" fill="var(--accent-teal)" opacity="0.8" />
                  <line x1="32" y1="22" x2="20" y2="38" stroke="var(--accent-teal)" strokeWidth="2" opacity="0.6" />
                  <line x1="32" y1="22" x2="44" y2="38" stroke="var(--accent-teal)" strokeWidth="2" opacity="0.6" />
                  <line x1="22" y1="44" x2="42" y2="44" stroke="var(--accent-teal)" strokeWidth="2" opacity="0.6" />
                </svg>
                <h1 className="mb-8" style={{ fontFamily: "var(--font-display)", fontSize: "28px", color: "var(--text-primary)" }}>
                  What would you like to know?
                </h1>
                <div className="grid grid-cols-2 gap-3 w-full max-w-[600px]">
                  {suggestedQuestions.map((question, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(question)}
                      className="p-4 rounded-lg text-left transition-all duration-200 hover:scale-[1.02]"
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--surface)",
                        color: "var(--text-secondary)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "13px",
                      }}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <div key={message.id} className="mb-6">
                    {message.role === "user" ? (
                      <div className="flex justify-end">
                        <div
                          className="max-w-[60%] px-4 py-3 rounded-2xl"
                          style={{
                            background: "var(--elevated)",
                            border: "1px solid var(--border)",
                            borderRadius: "16px 16px 4px 16px",
                            color: "var(--text-primary)",
                            fontFamily: "var(--font-mono)",
                            fontSize: "13px",
                          }}
                        >
                          {message.content}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full">
                        {message.fromCache && (
                          <div
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded mb-2 text-[10px]"
                            style={{
                              background: "rgba(107, 127, 255, 0.12)",
                              color: "var(--accent-indigo)",
                              fontFamily: "var(--font-mono)",
                              border: "1px solid rgba(107, 127, 255, 0.2)",
                            }}
                          >
                            ⚡ cached
                          </div>
                        )}
                        <MarkdownMessage content={message.content} />
                        {(message.latency_ms || message.model_used) && (
                          <div className="flex items-center gap-3 mt-3 text-[11px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                            {message.model_used && <span>{message.model_used}</span>}
                            {message.latency_ms && <span>{message.latency_ms.toFixed(0)}ms</span>}
                            {message.faithfulness_score != null && (
                              <span style={{ color: message.faithfulness_score >= 0.75 ? "var(--success)" : "var(--accent-amber)" }}>
                                f={message.faithfulness_score.toFixed(2)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {isStreaming && (
                  <div className="w-full">
                    {/* Warm-up indicator — visible only before the first agent node fires */}
                    {activeNodes.length === 0 && streamingText === "" && (
                      <div className="flex items-center gap-2 mb-4 text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                        <div className="flex gap-1">
                          {[0, 150, 300].map((delay) => (
                            <div
                              key={delay}
                              className="w-1.5 h-1.5 rounded-full animate-bounce"
                              style={{ background: "var(--accent-teal)", animationDelay: `${delay}ms` }}
                            />
                          ))}
                        </div>
                        <span>Thinking…</span>
                      </div>
                    )}

                    {/* Live Agent Status */}
                    {activeNodes.length > 0 && (
                      <div className="flex items-center gap-4 mb-4 text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                        {activeNodes.map((step, i) => (
                          <div key={step.node} className="flex items-center gap-2">
                            {i > 0 && <div className="w-8 h-px" style={{ background: "var(--border)" }} />}
                            <div
                              className="w-2 h-2 rounded-full"
                              style={{
                                background: step.status === "active" ? "var(--accent-teal)" : "var(--success)",
                                boxShadow: step.status === "active" ? "0 0 6px var(--accent-teal)" : "none",
                              }}
                            />
                            <span style={{ color: step.status === "active" ? "var(--text-primary)" : "var(--text-secondary)" }}>
                              {NODE_LABELS[step.node] ?? step.node}
                            </span>
                            {step.data?.latency_ms != null && (
                              <span style={{ color: "var(--text-tertiary)" }}>
                                {Math.round(step.data.latency_ms as number)}ms
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ position: "relative" }}>
                      <MarkdownMessage content={streamingText} />
                      <span
                        className="inline-block w-0.5 h-4 ml-0.5 animate-pulse"
                        style={{ background: "var(--accent-teal)", verticalAlign: "middle" }}
                      />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>
        </div>

        {/* Message Composer */}
        <div className="p-6">
          <div className="max-w-[720px] mx-auto">
            <div
              className="rounded-2xl p-4"
              style={{
                background: "var(--elevated)",
                border: "1px solid var(--border)",
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask about your knowledge base..."
                className="w-full bg-transparent border-0 outline-none resize-none"
                style={{
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                  minHeight: "60px",
                }}
              />
              {/* Upload toast */}
              {uploadToast && (
                <div
                  className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg text-[12px]"
                  style={{
                    background: uploadToast.ok ? "rgba(0,217,192,0.1)" : "rgba(255,80,80,0.1)",
                    border: `1px solid ${uploadToast.ok ? "rgba(0,217,192,0.25)" : "rgba(255,80,80,0.25)"}`,
                    color: uploadToast.ok ? "var(--accent-teal)" : "var(--danger)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <Check size={12} />
                  {uploadToast.text}
                </div>
              )}

              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,.md,.docx,.html"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <button
                    className="p-2 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: "var(--text-secondary)" }}
                    title="Attach document"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip size={16} />
                  </button>

                  {/* Model selector */}
                  <div className="relative">
                    <button
                      className="px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors text-[11px] hover:bg-white/5"
                      style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
                      onClick={() => setModelMenuOpen((v) => !v)}
                    >
                      {MODELS.find((m) => m.id === selectedModel)?.label ?? "Auto"}
                      <ChevronDown size={12} />
                    </button>
                    {modelMenuOpen && (
                      <div
                        className="absolute bottom-full mb-1 left-0 rounded-xl overflow-hidden z-50 min-w-[160px]"
                        style={{ background: "var(--elevated)", border: "1px solid var(--border)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}
                      >
                        {MODELS.map((m) => (
                          <button
                            key={String(m.id)}
                            className="w-full px-4 py-2.5 flex items-center justify-between gap-4 text-left hover:bg-white/5 transition-colors"
                            onClick={() => { setSelectedModel(m.id); setModelMenuOpen(false); }}
                          >
                            <div>
                              <div className="text-[12px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>{m.label}</div>
                              <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{m.desc}</div>
                            </div>
                            {selectedModel === m.id && <Check size={12} style={{ color: "var(--accent-teal)", flexShrink: 0 }} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    {input.length} chars
                  </span>
                  <button
                    onClick={isStreaming ? handleStop : handleSend}
                    disabled={!isStreaming && !input.trim()}
                    className="px-4 py-2 rounded-xl flex items-center gap-2 transition-all disabled:opacity-50"
                    style={{
                      background: isStreaming ? "var(--danger)" : "var(--accent-teal)",
                      color: "var(--background)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "13px",
                    }}
                  >
                    {isStreaming ? <Square size={14} /> : <Send size={14} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Context Panel */}
      <div
        className="flex flex-col flex-shrink-0 transition-all duration-300 overflow-hidden"
        style={{
          width: rightCollapsed ? "36px" : "360px",
          borderLeft: "1px solid var(--border)",
        }}
      >
        {rightCollapsed ? (
          <button
            onClick={() => setRightCollapsed(false)}
            className="flex-1 flex flex-col items-center justify-center gap-3 transition-colors"
            style={{ color: "var(--text-tertiary)" }}
            title="Expand panel"
          >
            <ChevronLeft size={14} />
            <span
              className="text-[10px] tracking-widest"
              style={{ fontFamily: "var(--font-mono)", writingMode: "vertical-rl", transform: "rotate(180deg)", color: "var(--text-tertiary)" }}
            >
              SOURCES
            </span>
          </button>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex border-b items-center" style={{ borderColor: "var(--border)" }}>
              {(["sources", "trace", "graph"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setCurrentTab(tab)}
                  className="flex-1 py-3 text-[11px] uppercase tracking-wider transition-colors"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: currentTab === tab ? "var(--accent-teal)" : "var(--text-secondary)",
                    borderBottom: currentTab === tab ? "2px solid var(--accent-teal)" : "2px solid transparent",
                  }}
                >
                  {tab}
                </button>
              ))}
              <button
                onClick={() => setRightCollapsed(true)}
                className="px-3 py-3 transition-colors"
                style={{ color: "var(--text-tertiary)" }}
                title="Collapse panel"
              >
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">

              {/* ── SOURCES ── */}
              {currentTab === "sources" && (() => {
                const cits = isStreaming ? currentCitations : (lastAssistant?.citations ?? []);
                if (!cits.length) return (
                  <div className="text-center py-12" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
                    Sources appear after a query
                  </div>
                );
                const normMap = normalisedRelevance(cits);
                return cits.map((c) => {
                  const name = displaySourceName(c.title);
                  const pct  = normMap.get(c.id) ?? c.relevance;
                  const relevColor = pct >= 75
                    ? "var(--success)"
                    : pct >= 45
                    ? "var(--accent-amber)"
                    : "var(--text-tertiary)";
                  return (
                    <div
                      key={c.id}
                      className="rounded-xl overflow-hidden transition-all duration-200 hover:translate-y-[-1px]"
                      style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}
                    >
                      {/* Header bar coloured by relative relevance */}
                      <div className="h-0.5" style={{ background: relevColor, opacity: 0.6 }} />
                      <div className="p-3">
                        {/* Source identity row */}
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{
                              background: "rgba(0,217,192,0.12)",
                              color: "var(--accent-teal)",
                              fontFamily: "var(--font-mono)",
                              flexShrink: 0,
                            }}
                          >
                            [{c.id}]
                          </span>
                          {fileIcon(c.title)}
                          <span
                            className="text-[12px] truncate font-medium"
                            style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}
                            title={c.title}
                          >
                            {name}
                          </span>
                        </div>

                        {/* Excerpt */}
                        {c.text && (
                          <p
                            className="text-[12px] leading-relaxed mb-3 line-clamp-3"
                            style={{
                              color: "var(--text-secondary)",
                              fontFamily: "var(--font-body)",
                              borderLeft: "2px solid var(--border)",
                              paddingLeft: "8px",
                            }}
                          >
                            {c.text}
                          </p>
                        )}

                        {/* Relative relevance bar */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--surface)" }}>
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ background: relevColor, width: `${pct}%` }}
                            />
                          </div>
                          <span
                            className="text-[10px] tabular-nums"
                            style={{ color: relevColor, fontFamily: "var(--font-mono)", minWidth: "30px", textAlign: "right" }}
                          >
                            {pct}%
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}

              {/* ── TRACE ── */}
              {currentTab === "trace" && (() => {
                const steps = isStreaming ? activeNodes : (lastAssistant?.traceSteps ?? []);
                const stepsMap = new Map(steps.map(s => [s.node, s]));

                if (!steps.length) return (
                  <div className="text-center py-12" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
                    Agent trace appears after a query
                  </div>
                );

                // Ordered pipeline — only show nodes that actually ran
                const pipelineNodes = PIPELINE_ORDER.filter(n => stepsMap.has(n));

                return (
                  <div>
                    {pipelineNodes.map((nodeKey, i) => {
                      const step = stepsMap.get(nodeKey)!;
                      const isActive = step.status === "active";
                      const dotColor = isActive ? "var(--accent-teal)" : "var(--success)";

                      // Per-node summary line
                      let summary: string | null = null;
                      if (nodeKey === "classifier" && step.data) {
                        const route = step.data.route as string | null;
                        const model = step.data.model_used as string | null;
                        const parts = [route && `→ ${route}`, model].filter(Boolean);
                        if (parts.length) summary = parts.join("  ·  ");
                      } else if (nodeKey === "researcher" && step.data) {
                        const chunks = step.data.chunk_count as number | null;
                        const cits = step.data.citation_count as number | null;
                        summary = [
                          chunks != null && `${chunks} chunks`,
                          cits  != null && `${cits} citations`,
                        ].filter(Boolean).join("  ·  ") || null;
                      } else if (nodeKey === "reviewer" && step.data) {
                        const f = step.data.faithfulness_score as number | null;
                        const r = step.data.retry_count as number | null;
                        summary = [
                          f != null && `f=${f.toFixed(2)}`,
                          r != null && r > 0 && `${r} retr${r === 1 ? "y" : "ies"}`,
                        ].filter(Boolean).join("  ·  ") || null;
                      } else if (nodeKey === "coder" && step.data) {
                        summary = step.data.has_code ? "code block generated" : null;
                      }

                      const faithfulness = nodeKey === "reviewer"
                        ? (step.data?.faithfulness_score as number | null)
                        : null;

                      return (
                        <div key={nodeKey} className="relative">
                          {/* Vertical connector */}
                          {i < pipelineNodes.length - 1 && (
                            <div
                              className="absolute left-[7px] top-[22px] w-px"
                              style={{ height: "calc(100% - 10px)", background: "var(--border)" }}
                            />
                          )}

                          <div className="flex gap-3 pb-4">
                            {/* Status dot */}
                            <div className="flex flex-col items-center pt-0.5 flex-shrink-0">
                              <div
                                className="w-3.5 h-3.5 rounded-full flex items-center justify-center"
                                style={{
                                  background: dotColor,
                                  boxShadow: isActive ? `0 0 8px ${dotColor}` : "none",
                                }}
                              >
                                {!isActive && (
                                  <svg width="7" height="6" viewBox="0 0 7 6" fill="none">
                                    <polyline points="1,3 3,5 6,1" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </div>
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className="text-[12px] font-medium"
                                  style={{ color: isActive ? "var(--text-primary)" : "var(--text-secondary)", fontFamily: "var(--font-mono)" }}
                                >
                                  {NODE_LABELS[nodeKey] ?? nodeKey}
                                </span>
                                {!isActive && step.data?.latency_ms != null && (
                                  <span className="text-[10px] ml-auto" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                                    {Math.round(step.data.latency_ms as number)}ms
                                  </span>
                                )}
                                {isActive && (
                                  <Loader2 size={10} className="animate-spin ml-auto" style={{ color: "var(--accent-teal)" }} />
                                )}
                              </div>

                              {summary && (
                                <div
                                  className="text-[11px] mt-0.5"
                                  style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
                                >
                                  {summary}
                                </div>
                              )}

                              {/* Faithfulness bar for reviewer */}
                              {faithfulness != null && (
                                <div className="flex items-center gap-2 mt-1.5">
                                  <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--surface)" }}>
                                    <div
                                      className="h-full rounded-full transition-all duration-700"
                                      style={{
                                        width: `${Math.round(faithfulness * 100)}%`,
                                        background: faithfulness >= 0.75 ? "var(--success)" : "var(--accent-amber)",
                                      }}
                                    />
                                  </div>
                                  <span
                                    className="text-[10px]"
                                    style={{
                                      fontFamily: "var(--font-mono)",
                                      color: faithfulness >= 0.75 ? "var(--success)" : "var(--accent-amber)",
                                    }}
                                  >
                                    {Math.round(faithfulness * 100)}%
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Total latency footer */}
                    {!isStreaming && lastAssistant?.latency_ms && (
                      <div
                        className="flex items-center justify-between pt-2 mt-1 text-[11px]"
                        style={{
                          borderTop: "1px solid var(--border)",
                          color: "var(--text-tertiary)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        <span>total</span>
                        <span style={{ color: "var(--accent-amber)" }}>
                          {lastAssistant.latency_ms.toFixed(0)}ms
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── GRAPH ── */}
              {currentTab === "graph" && (() => {
                const hasCitations = (isStreaming ? currentCitations : (lastAssistant?.citations ?? [])).length > 0;

                if (!hasCitations) return (
                  <div className="text-center py-12" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
                    Graph context appears after a query
                  </div>
                );

                const nodeIndex = new Map(miniGraphNodes.map(n => [n.id, n]));

                return (
                  <div>
                    {/* Mini canvas — dark background matching full KnowledgeGraph page */}
                    <div
                      className="rounded-xl overflow-hidden relative"
                      style={{ background: "var(--background)", border: "1px solid var(--border)", height: "240px" }}
                    >
                      {miniGraphLoading && (
                        <div className="absolute inset-0 flex items-center justify-center gap-2"
                          style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                          <Loader2 size={14} className="animate-spin" style={{ color: "var(--accent-teal)" }} />
                          <span>Loading subgraph…</span>
                        </div>
                      )}

                      {!miniGraphLoading && miniGraphNodes.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center"
                          style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                          No graph data for this source
                        </div>
                      )}

                      {miniGraphNodes.length > 0 && (
                        <svg
                          viewBox="0 0 320 240"
                          className="w-full h-full"
                          style={{ display: "block" }}
                        >
                          <defs>
                            {/* Per-node glow filters */}
                            {miniGraphNodes.map((n) => (
                              <filter key={`glow-${n.id}`} id={`mg-glow-${n.id}`} x="-60%" y="-60%" width="220%" height="220%">
                                <feGaussianBlur stdDeviation="2.5" result="blur" />
                                <feMerge>
                                  <feMergeNode in="blur" />
                                  <feMergeNode in="SourceGraphic" />
                                </feMerge>
                              </filter>
                            ))}
                          </defs>

                          {/* Edges — drawn first (under nodes) */}
                          {miniGraphEdges.map((e, i) => {
                            const s = nodeIndex.get(e.source);
                            const t = nodeIndex.get(e.target);
                            if (!s || !t) return null;
                            const isHighlighted = hoveredNode === s.id || hoveredNode === t.id;
                            return (
                              <line
                                key={i}
                                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                                stroke={isHighlighted ? s.color : "rgba(255,255,255,0.08)"}
                                strokeWidth={isHighlighted ? 1.2 : 0.6}
                                opacity={isHighlighted ? 0.7 : 1}
                                style={{ transition: "stroke 0.15s, opacity 0.15s" }}
                              />
                            );
                          })}

                          {/* Nodes */}
                          {miniGraphNodes.map((n) => {
                            const isHovered = hoveredNode === n.id;
                            const dimmed = hoveredNode !== null && !isHovered;
                            return (
                              <g
                                key={n.id}
                                style={{ cursor: "pointer" }}
                                onMouseEnter={() => setHoveredNode(n.id)}
                                onMouseLeave={() => setHoveredNode(null)}
                              >
                                {/* Outer glow ring on hover */}
                                {isHovered && (
                                  <circle cx={n.x} cy={n.y} r={n.size + 5}
                                    fill="none" stroke={n.color} strokeWidth="1"
                                    opacity="0.25" />
                                )}
                                {/* Node body */}
                                <circle
                                  cx={n.x} cy={n.y} r={n.size}
                                  fill={n.color}
                                  opacity={dimmed ? 0.2 : 0.85}
                                  filter={isHovered ? `url(#mg-glow-${n.id})` : undefined}
                                  style={{ transition: "opacity 0.15s" }}
                                />
                                {/* Inner highlight */}
                                <circle
                                  cx={n.x - n.size * 0.25} cy={n.y - n.size * 0.25}
                                  r={n.size * 0.3}
                                  fill="white" opacity={dimmed ? 0 : 0.15}
                                  style={{ pointerEvents: "none" }}
                                />
                                {/* Label — always on hover, on large hubs otherwise */}
                                {(isHovered || n.size >= 13) && (
                                  <text
                                    x={n.x}
                                    y={n.y + n.size + 9}
                                    textAnchor="middle"
                                    fontSize="7"
                                    fill={isHovered ? "white" : "rgba(255,255,255,0.5)"}
                                    fontFamily="var(--font-mono)"
                                    style={{ pointerEvents: "none", userSelect: "none" }}
                                  >
                                    {n.label.length > 16 ? n.label.slice(0, 15) + "…" : n.label}
                                  </text>
                                )}
                              </g>
                            );
                          })}
                        </svg>
                      )}
                    </div>

                    {/* Stats row */}
                    {!miniGraphLoading && miniGraphNodes.length > 0 && (
                      <div
                        className="flex items-center justify-between mt-2 px-1 text-[10px]"
                        style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}
                      >
                        <span>
                          <span style={{ color: "var(--accent-teal)" }}>{miniGraphNodes.length}</span> entities
                          &nbsp;·&nbsp;
                          <span style={{ color: "var(--accent-indigo)" }}>{miniGraphEdges.length}</span> connections
                        </span>
                        <button
                          onClick={() => navigate("/graph")}
                          className="flex items-center gap-1 px-2 py-1 rounded transition-colors hover:bg-white/5"
                          style={{ color: "var(--accent-teal)" }}
                        >
                          <Network size={10} />
                          <span>Full graph</span>
                          <ExternalLink size={9} />
                        </button>
                      </div>
                    )}

                    {/* Entity type legend */}
                    {!miniGraphLoading && miniGraphNodes.length > 0 && (() => {
                      const types = [...new Set(miniGraphNodes.map(n => n.type))].slice(0, 5);
                      return (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {types.map(t => (
                            <span
                              key={t}
                              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px]"
                              style={{
                                background: entityColor(t) + "18",
                                border: `1px solid ${entityColor(t)}40`,
                                color: entityColor(t),
                                fontFamily: "var(--font-mono)",
                              }}
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full inline-block"
                                style={{ background: entityColor(t) }}
                              />
                              {t}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

            </div>
          </>
        )}
      </div>
    </div>
  );
}
