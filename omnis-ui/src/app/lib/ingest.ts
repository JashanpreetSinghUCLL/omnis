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
}

export async function startIngestion(
  file: File,
  tenantId = "default",
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const endpoint = `${getApiBaseUrl()}/v1/ingest?tenant_id=${encodeURIComponent(tenantId)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Failed to start ingestion (${response.status})`);
  }

  const data = (await response.json()) as { job_id: string };
  return data.job_id;
}

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
      // Ignore malformed events to keep the stream resilient.
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
