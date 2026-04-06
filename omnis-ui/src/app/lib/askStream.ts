import { getApiBaseUrl } from "./api";

export type AskStreamEvent =
  | { type: "tool_start"; node: string; ts: number }
  | {
      type: "tool_result";
      node: string;
      ts: number;
      data: Record<string, unknown>;
    }
  | { type: "delta"; node?: string; content: string }
  | {
      type: "citation";
      index: number;
      source: string;
      chunk_id?: string | null;
      score?: number | null;
    }
  | { type: "cache_hit"; layer: "L1" | "L2" | "L3"; similarity?: number | null }
  | {
      type: "final";
      answer: string;
      model_used: string;
      retry_count: number;
      faithfulness_score?: number | null;
      latency_ms: number;
    }
  | { type: "error"; detail: string };

export interface AskPayload {
  question: string;
  tenant_id?: string;
  session_id?: string;
}

function parseSseFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { frames: parts, rest };
}

function parseEventFrame(frame: string): AskStreamEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());

  if (dataLines.length === 0) {
    return null;
  }

  const rawPayload = dataLines.join("\n");
  try {
    return JSON.parse(rawPayload) as AskStreamEvent;
  } catch {
    return null;
  }
}

export async function streamAsk(
  payload: AskPayload,
  onEvent: (event: AskStreamEvent) => void,
): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/v1/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      tenant_id: payload.tenant_id ?? "default",
      session_id: payload.session_id ?? "default",
      question: payload.question,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ask stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const { frames, rest } = parseSseFrames(buffer);
    buffer = rest;

    for (const frame of frames) {
      const event = parseEventFrame(frame);
      if (event) {
        onEvent(event);
      }
    }
  }
}
