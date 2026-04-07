import { getApiBaseUrl, getWsBaseUrl } from "./api";

export interface IngestProgressEvent {
  job_id: string;
  stage:
    | "parse"
    | "chunk"
    | "embed"
    | "graph"
    | "vector"
    | "complete"
    | "failed";
  status: "pending" | "running" | "done" | "error";
  detail?: string;
  progress: number;
  ts: number;
  // Present on the "complete" event — avoids a separate REST round-trip
  page_count?: number;
  chunk_count?: number;
  entities_extracted?: number;
}

export interface JobStatusResponse {
  job_id: string;
  status: string; // "not_found" | "failed" | "complete" | ...
  error?: string;
  result?: Record<string, unknown>;
}

/** XHR-based upload so we get real byte-level upload progress. */
export function uploadWithProgress(
  file: File,
  onUploadProgress: (pct: number) => void,
  tenantId = "default",
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { job_id: string };
          resolve(data.job_id);
        } catch {
          reject(new Error("Invalid server response"));
        }
      } else {
        reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));

    xhr.open(
      "POST",
      `${getApiBaseUrl()}/v1/ingest?tenant_id=${encodeURIComponent(tenantId)}`,
    );
    xhr.send(formData);
  });
}

/** Poll the REST status endpoint once. Returns terminal status or "pending". */
export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  const res = await fetch(`${getApiBaseUrl()}/v1/ingest/${jobId}`);
  if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
  return res.json() as Promise<JobStatusResponse>;
}

/** Subscribe to real-time WebSocket progress. Returns an unsubscribe fn. */
export function subscribeIngestionProgress(
  jobId: string,
  onEvent: (event: IngestProgressEvent) => void,
  onClose?: () => void,
): () => void {
  const socket = new WebSocket(`${getWsBaseUrl()}/v1/ingest/${jobId}/progress`);

  socket.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as IngestProgressEvent;
      onEvent(event);
    } catch {
      // Ignore malformed events.
    }
  };

  socket.onerror = () => {
    onClose?.();
  };

  socket.onclose = () => {
    onClose?.();
  };

  return () => {
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }
  };
}

// Keep the old name for any callers that haven't been updated.
export async function startIngestion(
  file: File,
  tenantId = "default",
): Promise<string> {
  return uploadWithProgress(file, () => {}, tenantId);
}
