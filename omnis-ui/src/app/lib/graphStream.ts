import { getApiBaseUrl } from "./api";

// ── Wire types (must match api/schemas/graph.py) ────────────────────────────

export interface ApiGraphNode {
  type: "node";
  id: string;
  label: string;
  entity_type: string;
  degree: number;
  /** Pre-computed layout coordinates from the server. Null if not yet laid out. */
  x?: number | null;
  y?: number | null;
}

export interface ApiGraphEdge {
  type: "edge";
  source: string;
  target: string;
  relation?: string;
}

export interface ApiGraphDone {
  type: "done";
  total_nodes: number;
  total_edges: number;
}

export type GraphStreamEvent = ApiGraphNode | ApiGraphEdge | ApiGraphDone;

export interface GraphExploreParams {
  tenant_id?: string;
  entity_type?: string;
  depth?: number;
  limit?: number;
  cursor?: string;
}

/**
 * Stream the graph explore endpoint as an async generator of typed events.
 * The server sends NDJSON — one JSON object per line.
 */
export async function* streamGraphExplore(
  params: GraphExploreParams = {},
): AsyncGenerator<GraphStreamEvent> {
  const url = new URL(`${getApiBaseUrl()}/v1/graph/explore`);
  if (params.tenant_id) url.searchParams.set("tenant_id", params.tenant_id);
  if (params.entity_type) url.searchParams.set("entity_type", params.entity_type);
  if (params.depth != null) url.searchParams.set("depth", String(params.depth));
  if (params.limit != null) url.searchParams.set("limit", String(params.limit));
  if (params.cursor) url.searchParams.set("cursor", params.cursor);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/x-ndjson" },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Graph explore failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed) as GraphStreamEvent;
      } catch {
        // skip malformed NDJSON lines
      }
    }
  }

  // flush any remaining bytes
  const tail = buffer.trim();
  if (tail) {
    try {
      yield JSON.parse(tail) as GraphStreamEvent;
    } catch {
      // ignore
    }
  }
}
