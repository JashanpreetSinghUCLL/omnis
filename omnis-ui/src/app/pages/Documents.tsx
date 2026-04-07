import { useState, useRef } from "react";
import { Upload, Grid, List, RefreshCw, Trash2, Network, X } from "lucide-react";
import { useUpload, formatBytes, type UploadState, type OmnisDocument } from "../context/UploadContext";
import { getApiBaseUrl } from "../lib/api";

const PIPELINE_STAGES = ["parse", "chunk", "embed", "graph", "vector"] as const;

const STAGE_LABELS: Record<string, string> = {
  parse: "Parsing",
  chunk: "Chunking",
  embed: "Embedding",
  graph: "Graph",
  vector: "Indexing",
};

function getStatusColor(status: string) {
  switch (status) {
    case "indexed":
      return { bg: "rgba(0, 196, 140, 0.12)", color: "#00C48C", border: "rgba(0, 196, 140, 0.25)" };
    case "processing":
      return { bg: "rgba(255, 181, 71, 0.12)", color: "#FFB547", border: "rgba(255, 181, 71, 0.25)" };
    case "failed":
      return { bg: "rgba(255, 77, 106, 0.12)", color: "#FF4D6A", border: "rgba(255, 77, 106, 0.25)" };
    default:
      return { bg: "var(--surface)", color: "var(--text-secondary)", border: "var(--border)" };
  }
}

// ── Upload panel ──────────────────────────────────────────────────────────────

function UploadPanel({ state, onDismiss }: { state: UploadState; onDismiss: () => void }) {
  const { phase, fileName, fileSize, uploadPct, currentStage, completedStages, totalPct, detail } = state;

  const phaseLabel =
    phase === "uploading" ? `Uploading — ${uploadPct}%` :
    phase === "queued"    ? "Queued — waiting for worker…" :
    phase === "complete"  ? "Ingested successfully" :
    phase === "failed"    ? "Ingestion failed" :
    currentStage          ? `${STAGE_LABELS[currentStage] ?? currentStage}…` : "Processing…";

  const barColor =
    phase === "complete" ? "var(--success)" :
    phase === "failed"   ? "var(--danger)"  : "var(--accent-teal)";

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{
        background: "var(--elevated)",
        border: `1px solid ${phase === "failed" ? "var(--danger)" : phase === "complete" ? "var(--success)" : "var(--border)"}`,
        transition: "border-color 0.3s",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] truncate" style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
            {fileName}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            {fileSize}
          </div>
        </div>
        {(phase === "complete" || phase === "failed") && (
          <button onClick={onDismiss} className="flex-shrink-0 p-1 rounded" style={{ color: "var(--text-tertiary)" }}>
            <X size={12} />
          </button>
        )}
      </div>

      <div>
        <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${totalPct}%`, background: barColor }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[10px]" style={{ fontFamily: "var(--font-mono)" }}>
          <span style={{ color: phase === "failed" ? "var(--danger)" : phase === "complete" ? "var(--success)" : "var(--text-secondary)" }}>
            {phaseLabel}
          </span>
          <span style={{ color: "var(--text-tertiary)" }}>{totalPct}%</span>
        </div>
      </div>

      {(phase === "processing" || phase === "complete" || phase === "failed") && (
        <div className="flex items-center gap-3 flex-wrap">
          {PIPELINE_STAGES.map((s) => {
            const done   = completedStages.has(s);
            const active = currentStage === s && !done;
            return (
              <div key={s} className="flex items-center gap-1.5">
                <div
                  className={active ? "animate-pulse" : ""}
                  style={{
                    width: "7px", height: "7px", borderRadius: "50%",
                    background: done ? "var(--success)" : active ? "var(--accent-teal)" : "var(--border)",
                    boxShadow: active ? "0 0 5px var(--accent-teal)" : "none",
                    transition: "background 0.3s",
                  }}
                />
                <span className="text-[10px]" style={{
                  fontFamily: "var(--font-mono)",
                  color: done ? "var(--success)" : active ? "var(--text-primary)" : "var(--text-tertiary)",
                  transition: "color 0.3s",
                }}>
                  {STAGE_LABELS[s]}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {phase === "failed" && detail && (
        <div className="text-[11px] rounded p-2" style={{
          background: "rgba(255, 77, 106, 0.08)",
          color: "var(--danger)",
          fontFamily: "var(--font-mono)",
          border: "1px solid rgba(255, 77, 106, 0.2)",
        }}>
          {detail}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Documents() {
  const { uploadState, documents, startUpload, dismissUpload, addDocument, updateDocument, removeDocument } = useUpload();
  const [view, setView] = useState<"table" | "grid">("table");
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDelete = async (doc: OmnisDocument) => {
    if (deleting === doc.id) return;
    setDeleting(doc.id);
    try {
      await fetch(`${getApiBaseUrl()}/v1/documents?source=${encodeURIComponent(doc.name)}`, { method: "DELETE" });
    } catch { /* network error — still remove from UI */ }
    removeDocument(doc.id);
    setDeleting(null);
  };

  const handleRefreshMeta = async (doc: OmnisDocument) => {
    if (refreshing === doc.id) return;
    setRefreshing(doc.id);
    try {
      const res = await fetch(`${getApiBaseUrl()}/v1/graph/meta?source=${encodeURIComponent(doc.name)}`);
      if (res.ok) {
        const data = await res.json() as { pages: number; chunks: number; nodes: number };
        updateDocument(doc.id, { pages: data.pages, chunks: data.chunks, nodes: data.nodes, status: "indexed" });
      }
    } catch { /* network error — leave as-is */ }
    setRefreshing(null);
  };

  const handleFile = async (file: File) => {
    const docId = crypto.randomUUID();
    const newDoc: OmnisDocument = {
      id: docId,
      name: file.name,
      pages: 0, chunks: 0, nodes: 0,
      ingested: new Date().toISOString().split("T")[0],
      status: "processing",
      size: formatBytes(file.size),
    };
    addDocument(newDoc);
    await startUpload(file, docId);
  };

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); };
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; };

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--background)" }}>
      <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md,.docx,.html,.htm" className="hidden" onChange={handleInputChange} />

      <div className="flex-1 overflow-hidden p-6">
        <div className="max-w-[1400px] mx-auto h-full flex gap-6">

          {/* Left column */}
          <div className="w-[300px] flex-shrink-0 flex flex-col gap-4">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="h-[180px] rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all duration-200 hover:scale-[1.01]"
              style={{ border: "2px dashed var(--border)", background: "var(--surface)" }}
            >
              <Upload size={28} style={{ color: "var(--accent-teal)", marginBottom: "10px" }} />
              <div className="text-[13px] text-center px-4" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                Drop files here or click to upload
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                PDF, TXT, MD, DOCX, HTML
              </div>
            </div>

            {uploadState && <UploadPanel state={uploadState} onDismiss={dismissUpload} />}

            <div className="space-y-3">
              <div className="p-4 rounded-lg" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="text-[11px] mb-1" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>TOTAL DOCUMENTS</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "32px", color: "var(--text-primary)" }}>{documents.length}</div>
              </div>
              <div className="p-4 rounded-lg" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="text-[11px] mb-1" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>TOTAL CHUNKS</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "32px", color: "var(--text-primary)" }}>
                  {documents.reduce((s, d) => s + d.chunks, 0).toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "28px", color: "var(--text-primary)" }}>Documents</h2>
              <div className="flex items-center gap-2">
                {(["table", "grid"] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className="p-2 rounded transition-colors"
                    style={{ background: view === v ? "var(--elevated)" : "transparent", color: view === v ? "var(--accent-teal)" : "var(--text-secondary)" }}>
                    {v === "table" ? <List size={16} /> : <Grid size={16} />}
                  </button>
                ))}
              </div>
            </div>

            {documents.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-[13px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                No documents yet — upload a file to get started.
              </div>
            ) : view === "table" ? (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0" style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    <tr>
                      {["NAME", "PAGES", "CHUNKS", "NODES", "INGESTED", "STATUS", "ACTIONS"].map((h) => (
                        <th key={h} className="text-left py-3 px-4 text-[11px]"
                          style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => {
                      const sc = getStatusColor(doc.status);
                      return (
                        <tr key={doc.id} className="group" style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="py-3 px-4 text-[13px]" style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{doc.name}</td>
                          <td className="py-3 px-4 text-[13px]" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>{doc.pages || "—"}</td>
                          <td className="py-3 px-4 text-[13px]" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>{doc.chunks ? doc.chunks.toLocaleString() : "—"}</td>
                          <td className="py-3 px-4 text-[13px]" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>{doc.nodes || "—"}</td>
                          <td className="py-3 px-4 text-[13px]" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>{doc.ingested}</td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-1 rounded text-[11px]"
                              style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, fontFamily: "var(--font-mono)" }}>
                              {doc.status}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                className="p-1.5 rounded"
                                style={{ color: "var(--text-secondary)" }}
                                title="Refresh metadata"
                                onClick={() => handleRefreshMeta(doc)}
                              >
                                <RefreshCw size={14} className={refreshing === doc.id ? "animate-spin" : ""} />
                              </button>
                              <button className="p-1.5 rounded" style={{ color: "var(--text-secondary)" }}><Network size={14} /></button>
                              <button
                                className="p-1.5 rounded"
                                style={{ color: "var(--danger)" }}
                                title="Delete document"
                                onClick={() => handleDelete(doc)}
                                disabled={deleting === doc.id}
                              >
                                <Trash2 size={14} className={deleting === doc.id ? "animate-pulse" : ""} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-3 gap-4">
                  {documents.map((doc) => {
                    const sc  = getStatusColor(doc.status);
                    const hue = doc.name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
                    return (
                      <div key={doc.id} className="rounded-xl overflow-hidden hover:scale-[1.02] transition-transform cursor-pointer"
                        style={{ border: "1px solid var(--border)", background: "var(--elevated)" }}>
                        <div className="h-24" style={{ background: `hsl(${hue}, 30%, 25%)` }} />
                        <div className="p-4">
                          <div className="text-[13px] mb-2 truncate" style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{doc.name}</div>
                          <div className="flex items-center justify-between mb-3 text-[11px]" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                            <span>{doc.pages ? `${doc.pages} pages` : doc.size}</span>
                            <span>{doc.nodes ? `${doc.nodes} nodes` : ""}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="px-2 py-1 rounded text-[10px]"
                              style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, fontFamily: "var(--font-mono)" }}>
                              {doc.status}
                            </span>
                            <span className="text-[11px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>{doc.ingested}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
