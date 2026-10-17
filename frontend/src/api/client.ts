import type {
  ApiErrorPayload,
  ForecastHorizon,
  ForecastResponse,
  HistoryRange,
  HistoryResponse,
  Security,
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export class ApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string;

  constructor(payload: ApiErrorPayload["error"]) {
    super(payload.message);
    this.name = "ApiError";
    this.code = payload.code;
    this.retryable = payload.retryable;
    this.requestId = payload.request_id;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as T | ApiErrorPayload;
  if (!response.ok) {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload
    ) {
      throw new ApiError((payload as ApiErrorPayload).error);
    }
    throw new Error("The server returned an unreadable error.");
  }
  return payload as T;
}

export async function searchSecurities(
  query: string,
  signal: AbortSignal,
): Promise<Security[]> {
  const params = new URLSearchParams({ q: query, limit: "8" });
  const response = await request<{ results: Security[] }>(
    `/securities/search?${params}`,
    { signal },
  );
  return response.results;
}

export function getHistory(
  symbol: string,
  range: HistoryRange,
  signal: AbortSignal,
): Promise<HistoryResponse> {
  return request(
    `/securities/${encodeURIComponent(symbol)}/history?range=${range}`,
    { signal },
  );
}

export function createForecast(
  symbol: string,
  horizon: ForecastHorizon,
  signal: AbortSignal,
): Promise<ForecastResponse> {
  return request("/forecasts", {
    method: "POST",
    body: JSON.stringify({ symbol, horizon }),
    signal,
  });
}
