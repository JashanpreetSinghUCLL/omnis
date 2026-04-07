/**
 * UploadContext — persists across route changes (lives above the router).
 *
 * - Upload state: survives tab switches (in-memory context).
 * - Document list: persisted to localStorage, survives refresh.
 * - Active job: persisted to localStorage, polling resumes after refresh.
 */
import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  uploadWithProgress,
  subscribeIngestionProgress,
  getJobStatus,
  type IngestProgressEvent,
} from "../lib/ingest";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface OmnisDocument {
  id: string;
  name: string;
  pages: number;
  chunks: number;
  nodes: number;
  ingested: string;
  status: "indexed" | "processing" | "failed";
  size: string;
}

export type UploadPhase = "uploading" | "queued" | "processing" | "complete" | "failed";

export interface UploadState {
  docId: string;
  fileName: string;
  fileSize: string;
  jobId: string | null;
  phase: UploadPhase;
  uploadPct: number;
  currentStage: IngestProgressEvent["stage"] | null;
  completedStages: Set<IngestProgressEvent["stage"]>;
  stagePct: number;
  detail: string | null;
  totalPct: number;
}

interface UploadContextValue {
  uploadState: UploadState | null;
  documents: OmnisDocument[];
  addDocument: (doc: OmnisDocument) => void;
  updateDocument: (id: string, patch: Partial<OmnisDocument>) => void;
  startUpload: (file: File, docId: string) => Promise<void>;
  dismissUpload: () => void;
  removeDocument: (id: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function computeTotalPct(phase: UploadPhase, uploadPct: number, stagePct: number): number {
  if (phase === "uploading") return Math.round(uploadPct * 0.25);
  if (phase === "queued")    return 25;
  if (phase === "complete")  return 100;
  return Math.min(99, Math.round(25 + (stagePct / 100) * 75));
}

// localStorage helpers (silently ignore quota errors)
const LS_DOCS    = "omnis:documents";
const LS_PENDING = "omnis:pending-job";

function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; }
  catch { return fallback; }
}
function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function lsDel(key: string) {
  try { localStorage.removeItem(key); } catch {}
}

// ── Context ───────────────────────────────────────────────────────────────────

const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { readonly children: ReactNode }) {
  // Document list — initialised from localStorage; synced back on every change
  const [documents, setDocuments] = useState<OmnisDocument[]>(() => lsGet<OmnisDocument[]>(LS_DOCS, []));
  const [uploadState, setUploadState] = useState<UploadState | null>(null);

  useEffect(() => { lsSet(LS_DOCS, documents); }, [documents]);

  const unsubWsRef = useRef<(() => void) | null>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-dismiss completed uploads after 2.5 s
  useEffect(() => {
    if (uploadState?.phase === "complete") {
      const t = setTimeout(() => setUploadState(null), 2500);
      return () => clearTimeout(t);
    }
  }, [uploadState?.phase]);

  // On mount: resume a pending job that was in progress when the page was refreshed
  useEffect(() => {
    const pending = lsGet<{ jobId: string; docId: string; fileName: string; fileSize: string } | null>(LS_PENDING, null);
    if (!pending) return;
    const { jobId, docId, fileName, fileSize } = pending;
    setUploadState({
      docId, fileName, fileSize, jobId,
      phase: "queued", uploadPct: 100, totalPct: 25,
      currentStage: null, completedStages: new Set(), stagePct: 0, detail: null,
    });
    startPolling(jobId, docId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Tracking helpers ────────────────────────────────────────────────────────

  function stopTracking() {
    unsubWsRef.current?.();
    unsubWsRef.current = null;
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function markComplete(docId: string, result?: Record<string, unknown>) {
    stopTracking();
    lsDel(LS_PENDING);
    setUploadState((p) => p ? { ...p, phase: "complete", totalPct: 100, stagePct: 100 } : null);
    setDocuments((prev) => prev.map((d) => {
      if (d.id !== docId) return d;
      return {
        ...d,
        status: "indexed",
        pages:  (result?.page_count         as number | undefined) ?? d.pages,
        chunks: (result?.chunk_count        as number | undefined) ?? d.chunks,
        nodes:  (result?.entities_extracted as number | undefined) ?? d.nodes,
      };
    }));
  }

  function markFailed(docId: string, detail?: string) {
    stopTracking();
    lsDel(LS_PENDING);
    setUploadState((p) => p ? { ...p, phase: "failed", detail: detail ?? "Ingestion failed" } : null);
    setDocuments((prev) => prev.map((d) => d.id === docId ? { ...d, status: "failed" } : d));
  }

  function startPolling(jobId: string, docId: string) {
    if (pollRef.current !== null) return;
    pollRef.current = setInterval(async () => {
      try {
        const s = await getJobStatus(jobId);
        if (s.status === "complete") markComplete(docId, s.result);
        else if (s.status === "failed") markFailed(docId, s.error);
        // "not_found" / pending → keep polling
      } catch { /* transient network error */ }
    }, 3000);
  }

  // ── Main upload flow ────────────────────────────────────────────────────────

  async function startUpload(file: File, docId: string) {
    stopTracking();
    lsDel(LS_PENDING);

    setUploadState({
      docId, fileName: file.name, fileSize: formatBytes(file.size), jobId: null,
      phase: "uploading", uploadPct: 0,
      currentStage: null, completedStages: new Set(), stagePct: 0, detail: null,
      totalPct: 0,
    });

    let jobId: string;
    try {
      jobId = await uploadWithProgress(file, (pct) => {
        setUploadState((p) => p ? { ...p, uploadPct: pct, totalPct: computeTotalPct("uploading", pct, 0) } : null);
      });
    } catch (err) {
      markFailed(docId, err instanceof Error ? err.message : "Upload failed");
      return;
    }

    // Persist so we can resume after a refresh
    lsSet(LS_PENDING, { jobId, docId, fileName: file.name, fileSize: formatBytes(file.size) });

    setUploadState((p) => p ? { ...p, jobId, phase: "queued", uploadPct: 100, totalPct: 25 } : null);

    // ── Run WebSocket + polling in parallel ──────────────────────────────────
    // Polling is the reliable fallback; WS gives real-time stage detail.
    // Whichever reaches a terminal state first wins; the other is stopped.
    startPolling(jobId, docId);

    unsubWsRef.current = subscribeIngestionProgress(
      jobId,
      (event: IngestProgressEvent) => {
        if (event.stage === "complete") {
          // Counts are embedded directly in the complete event to avoid
          // a race condition where Taskiq hasn't stored the result yet.
          markComplete(docId, {
            page_count: event.page_count,
            chunk_count: event.chunk_count,
            entities_extracted: event.entities_extracted,
          });
          return;
        }
        if (event.stage === "failed")   { markFailed(docId, event.detail); return; }

        setUploadState((p) => {
          if (!p) return null;
          const completed = new Set(p.completedStages);
          if (event.status === "done") completed.add(event.stage);
          return {
            ...p,
            phase: "processing",
            currentStage: event.stage,
            completedStages: completed,
            stagePct: event.progress,
            totalPct: computeTotalPct("processing", p.uploadPct, event.progress),
          };
        });
      },
      () => { /* WS closed — polling already running, nothing to do */ },
    );
  }

  function dismissUpload() {
    stopTracking();
    lsDel(LS_PENDING);
    setUploadState(null);
  }

  function addDocument(doc: OmnisDocument) {
    setDocuments((prev) => [doc, ...prev]);
  }

  function updateDocument(id: string, patch: Partial<OmnisDocument>) {
    setDocuments((prev) => prev.map((d) => d.id === id ? { ...d, ...patch } : d));
  }

  function removeDocument(id: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }

  const value = useMemo(
    () => ({ uploadState, documents, startUpload, dismissUpload, addDocument, updateDocument, removeDocument }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uploadState, documents],
  );

  return (
    <UploadContext.Provider value={value}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used inside UploadProvider");
  return ctx;
}
