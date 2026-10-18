export interface Security {
  symbol: string;
  name: string;
  exchange: string;
  region: string;
  currency: string;
  instrument_type: "common_stock";
  timezone?: string | null;
}

export interface PricePoint {
  date: string;
  adjusted_close: number;
}

export interface HistoryResponse {
  security: Security;
  prices: PricePoint[];
  metadata: {
    provider: string;
    retrieved_at: string;
    last_market_date: string;
    is_stale: boolean;
  };
}

export interface ForecastPoint {
  date: string;
  p10: number;
  p50: number;
  p90: number;
}

export interface ForecastAnalysis {
  latest_close: number;
  forecast_end: number;
  forecast_change_percent: number;
  historical_change_5d_percent: number | null;
  historical_change_20d_percent: number | null;
  sma_20: number | null;
  sma_50: number | null;
  trend: "upward" | "downward" | "mostly_flat";
  final_interval_width_percent: number;
  summary: string;
}

export interface ForecastResponse {
  forecast_id: string;
  security: Security;
  history: PricePoint[];
  forecast: ForecastPoint[];
  analysis: ForecastAnalysis;
  metadata: {
    horizon_trading_days: number;
    context_observations: number;
    context_start_date: string;
    context_end_date: string;
    provider: string;
    backend: string;
    model: string;
    model_version: string;
    preprocessing_version: string;
    generated_at: string;
    is_data_stale: boolean;
  };
  disclaimer: string;
}

export interface Nifty50ScreenResult {
  rank: number;
  security: Security;
  latest_close: number;
  forecast_end: number;
  forecast_change_percent: number;
  forecast_end_date: string;
  final_p10: number;
  final_p50: number;
  final_p90: number;
  final_interval_width_percent: number;
  is_data_stale: boolean;
}

export interface Nifty50ScreenResponse {
  results: Nifty50ScreenResult[];
  metadata: {
    horizon_trading_days: number;
    universe_size: number;
    analyzed_count: number;
    positive_count: number;
    unavailable_symbols: string[];
    provider: string;
    backend: string;
    model: string;
    model_version: string;
    generated_at: string;
  };
  disclaimer: string;
}

export interface BacktestPoint {
  date: string;
  actual: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface BacktestResponse {
  backtest_id: string;
  security: Security;
  points: BacktestPoint[];
  metrics: {
    mean_absolute_error: number;
    mean_absolute_percentage_error: number;
    interval_coverage_percent: number;
  };
  metadata: {
    holdout_sessions: number;
    context_observations: number;
    context_start_date: string;
    context_end_date: string;
    provider: string;
    backend: string;
    model: string;
    model_version: string;
    preprocessing_version: string;
    generated_at: string;
    is_data_stale: boolean;
  };
  disclaimer: string;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

export type HistoryRange = "6m" | "1y" | "2y" | "5y";
export type ForecastHorizon = 5 | 20 | 60;
