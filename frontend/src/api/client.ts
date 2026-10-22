import type {
  ApiErrorPayload,
  BacktestResponse,
  ForecastHorizon,
  ForecastResponse,
  HistoryRange,
  HistoryResponse,
  IndexScreenResponse,
  PortfolioOutlook,
  PortfolioOutlooks,
  PortfolioPosition,
  ResearchIndexId,
  Security,
  TrackingState,
  TrackingStateResponse,
  WatchlistItem,
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

interface ApiPortfolioOutlook {
  date: string;
  p10: number;
  p50: number;
  p90: number;
  generated_at: string;
}

interface ApiPortfolioPriceSnapshot {
  date: string;
  adjusted_close: number;
  captured_at: string;
}

interface ApiWatchlistItem {
  security: Security;
  latest_close: number;
  last_market_date: string;
  added_at: string;
}

interface ApiPortfolioPosition {
  security: Security;
  quantity: number;
  average_price: number;
  latest_close: number;
  last_market_date: string;
  outlooks: Partial<Record<"7" | "20" | "60", ApiPortfolioOutlook>>;
  price_history?: ApiPortfolioPriceSnapshot[];
  updated_at: string;
}

interface ApiTrackingState {
  watchlist: ApiWatchlistItem[];
  positions: ApiPortfolioPosition[];
  updated_at?: string | null;
}

export class ApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly details?: Record<string, unknown>;

  constructor(payload: ApiErrorPayload["error"]) {
    super(payload.message);
    this.name = "ApiError";
    this.code = payload.code;
    this.retryable = payload.retryable;
    this.requestId = payload.request_id;
    this.details = payload.details;
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

export function createBacktest(
  symbol: string,
  signal: AbortSignal,
): Promise<BacktestResponse> {
  return request("/backtests", {
    method: "POST",
    body: JSON.stringify({ symbol }),
    signal,
  });
}

export function screenIndex(
  indexId: ResearchIndexId,
  signal: AbortSignal,
): Promise<IndexScreenResponse> {
  return request("/research/indexes/screen", {
    method: "POST",
    body: JSON.stringify({ index_id: indexId, horizon: 20 }),
    signal,
  });
}

function fromApiOutlooks(
  outlooks: ApiPortfolioPosition["outlooks"],
): PortfolioOutlooks {
  return Object.fromEntries(
    Object.entries(outlooks).map(([horizon, outlook]) => [
      Number(horizon),
      {
        date: outlook.date,
        p10: outlook.p10,
        p50: outlook.p50,
        p90: outlook.p90,
        generatedAt: outlook.generated_at,
      } satisfies PortfolioOutlook,
    ]),
  ) as PortfolioOutlooks;
}

function fromApiTrackingState(state: ApiTrackingState): TrackingStateResponse {
  return {
    watchlist: state.watchlist.map(
      (item): WatchlistItem => ({
        security: item.security,
        latestClose: item.latest_close,
        lastMarketDate: item.last_market_date,
        addedAt: item.added_at,
      }),
    ),
    positions: state.positions.map(
      (position): PortfolioPosition => ({
        security: position.security,
        quantity: position.quantity,
        averagePrice: position.average_price,
        latestClose: position.latest_close,
        lastMarketDate: position.last_market_date,
        outlooks: fromApiOutlooks(position.outlooks),
        priceHistory: (position.price_history ?? []).map((snapshot) => ({
          date: snapshot.date,
          adjustedClose: snapshot.adjusted_close,
          capturedAt: snapshot.captured_at,
        })),
        updatedAt: position.updated_at,
      }),
    ),
    updatedAt: state.updated_at ?? null,
  };
}

function toApiTrackingState(state: TrackingState): ApiTrackingState {
  return {
    watchlist: state.watchlist.map((item) => ({
      security: item.security,
      latest_close: item.latestClose,
      last_market_date: item.lastMarketDate,
      added_at: item.addedAt,
    })),
    positions: state.positions.map((position) => ({
      security: position.security,
      quantity: position.quantity,
      average_price: position.averagePrice,
      latest_close: position.latestClose,
      last_market_date: position.lastMarketDate,
      outlooks: Object.fromEntries(
        Object.entries(position.outlooks ?? {}).map(([horizon, outlook]) => [
          horizon,
          {
            date: outlook.date,
            p10: outlook.p10,
            p50: outlook.p50,
            p90: outlook.p90,
            generated_at: outlook.generatedAt,
          },
        ]),
      ),
      updated_at: position.updatedAt,
    })),
  };
}

export async function getTrackingState(
  signal: AbortSignal,
): Promise<TrackingStateResponse> {
  return fromApiTrackingState(
    await request<ApiTrackingState>("/tracking", { signal }),
  );
}

export async function saveTrackingState(
  state: TrackingState,
): Promise<TrackingStateResponse> {
  return fromApiTrackingState(
    await request<ApiTrackingState>("/tracking", {
      method: "PUT",
      body: JSON.stringify(toApiTrackingState(state)),
    }),
  );
}
