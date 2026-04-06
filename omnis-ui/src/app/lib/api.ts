export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (raw && raw.trim().length > 0) {
    return raw.replace(/\/$/, "");
  }
  // In Docker: nginx proxies /v1/* → api:8000, so use same-origin (empty string).
  // In local dev (pnpm dev, no nginx): fall back to localhost:8000.
  return import.meta.env.DEV ? "http://localhost:8000" : "";
}

export function getWsBaseUrl(): string {
  const raw = import.meta.env.VITE_WS_BASE_URL as string | undefined;
  if (raw && raw.trim().length > 0) {
    return raw.replace(/\/$/, "");
  }

  const apiBase = getApiBaseUrl();
  if (apiBase.startsWith("https://")) {
    return apiBase.replace("https://", "wss://");
  }
  if (apiBase.startsWith("http://")) {
    return apiBase.replace("http://", "ws://");
  }
  return `ws://${apiBase}`;
}

export function getSessionId(): string {
  const key = "omnis-session-id";
  const existing = window.localStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const next = crypto.randomUUID();
  window.localStorage.setItem(key, next);
  return next;
}
