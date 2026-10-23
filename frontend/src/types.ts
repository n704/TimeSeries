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

export interface BacktestMetrics {
  mean_absolute_error: number;
  mean_absolute_percentage_error: number;
  interval_coverage_percent: number;
  directional_accuracy_percent: number;
  end_direction_match: boolean;
}

export interface ForecastCorrection {
  method: "latest_holdout_ratio";
  reference_date: string;
  signed_median_error_percent: number;
  scale_factor: number;
}

export interface HistoricalEvaluation {
  holdout_sessions: number;
  context_end_date: string;
  metrics: BacktestMetrics;
  correction?: ForecastCorrection | null;
}

export interface ForecastAnalysis {
  latest_close: number;
  forecast_end: number;
  forecast_change_percent: number;
  historical_change_5d_percent: number | null;
  historical_change_20d_percent: number | null;
  recent_trend: "upward" | "downward" | "mostly_flat";
  trend_alignment: "aligned" | "opposed" | "neutral";
  evidence_level: "supportive" | "mixed" | "limited";
  historical_evaluation: HistoricalEvaluation | null;
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

export type ResearchIndexId =
  | "nifty50"
  | "nifty_next50"
  | "nifty_midcap_select"
  | "nifty_smallcap100";

export interface IndexScreenResult {
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
  correction?: ForecastCorrection | null;
}

export interface IndexScreenResponse {
  results: IndexScreenResult[];
  metadata: {
    index_id: ResearchIndexId;
    index_name: string;
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
  metrics: BacktestMetrics;
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

export interface PortfolioOutlook {
  date: string;
  p10: number;
  p50: number;
  p90: number;
  generatedAt: string;
}

export type PortfolioOutlookHorizon = 5 | 7 | 20 | 60;
export type PortfolioOutlooks = Partial<
  Record<PortfolioOutlookHorizon, PortfolioOutlook>
>;

export interface WatchlistItem {
  security: Security;
  latestClose: number;
  lastMarketDate: string;
  addedAt: string;
}

export interface PortfolioPriceSnapshot {
  date: string;
  adjustedClose: number;
  capturedAt: string;
}

export interface PortfolioPosition {
  security: Security;
  quantity: number;
  averagePrice: number;
  latestClose: number;
  lastMarketDate: string;
  outlooks?: PortfolioOutlooks;
  priceHistory?: PortfolioPriceSnapshot[];
  updatedAt: string;
}

export interface TrackingState {
  watchlist: WatchlistItem[];
  positions: PortfolioPosition[];
}

export interface TrackingStateResponse extends TrackingState {
  updatedAt: string | null;
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
