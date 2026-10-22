from datetime import date, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class InstrumentType(StrEnum):
  COMMON_STOCK = "common_stock"


class Security(BaseModel):
  symbol: str
  name: str
  exchange: str
  region: str = "India"
  currency: str
  instrument_type: InstrumentType = InstrumentType.COMMON_STOCK
  timezone: str | None = None


class PricePoint(BaseModel):
  date: date
  adjusted_close: float = Field(gt=0)


class HistoryMetadata(BaseModel):
  provider: str
  retrieved_at: datetime
  last_market_date: date
  is_stale: bool


class HistoryResponse(BaseModel):
  security: Security
  prices: list[PricePoint]
  metadata: HistoryMetadata


class SearchResponse(BaseModel):
  results: list[Security]


class SecurityRequest(BaseModel):
  symbol: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.&\-^]+$")


class ForecastRequest(SecurityRequest):
  horizon: Literal[5, 20, 60]


class ForecastPoint(BaseModel):
  date: date
  p10: float = Field(gt=0)
  p50: float = Field(gt=0)
  p90: float = Field(gt=0)


class BacktestMetrics(BaseModel):
  mean_absolute_error: float = Field(ge=0)
  mean_absolute_percentage_error: float = Field(ge=0)
  interval_coverage_percent: float = Field(ge=0, le=100)
  directional_accuracy_percent: float = Field(ge=0, le=100)
  end_direction_match: bool


class ForecastCorrection(BaseModel):
  method: Literal["latest_holdout_ratio"] = "latest_holdout_ratio"
  reference_date: date
  signed_median_error_percent: float
  scale_factor: float = Field(gt=0)


class HistoricalEvaluation(BaseModel):
  holdout_sessions: int = Field(ge=1)
  context_end_date: date
  metrics: BacktestMetrics
  correction: ForecastCorrection | None = None


class Analysis(BaseModel):
  latest_close: float
  forecast_end: float
  forecast_change_percent: float
  historical_change_5d_percent: float | None
  historical_change_20d_percent: float | None
  recent_trend: Literal["upward", "downward", "mostly_flat"]
  trend_alignment: Literal["aligned", "opposed", "neutral"]
  evidence_level: Literal["supportive", "mixed", "limited"]
  historical_evaluation: HistoricalEvaluation | None
  sma_20: float | None
  sma_50: float | None
  trend: Literal["upward", "downward", "mostly_flat"]
  final_interval_width_percent: float
  summary: str


class ForecastMetadata(BaseModel):
  horizon_trading_days: int
  context_observations: int
  context_start_date: date
  context_end_date: date
  provider: str
  backend: str
  model: str
  model_version: str
  preprocessing_version: str = "1"
  generated_at: datetime
  is_data_stale: bool


class ForecastResponse(BaseModel):
  forecast_id: str
  security: Security
  history: list[PricePoint]
  forecast: list[ForecastPoint]
  analysis: Analysis
  metadata: ForecastMetadata
  disclaimer: str


class IndexScreenRequest(BaseModel):
  index_id: Literal[
      "nifty50",
      "nifty_next50",
      "nifty_midcap_select",
      "nifty_smallcap100",
  ] = "nifty50"
  horizon: Literal[20] = 20


class IndexScreenResult(BaseModel):
  rank: int = Field(ge=1, le=5)
  security: Security
  latest_close: float = Field(gt=0)
  forecast_end: float = Field(gt=0)
  forecast_change_percent: float = Field(gt=0)
  forecast_end_date: date
  final_p10: float = Field(gt=0)
  final_p50: float = Field(gt=0)
  final_p90: float = Field(gt=0)
  final_interval_width_percent: float = Field(ge=0)
  is_data_stale: bool
  correction: ForecastCorrection | None = None


class IndexScreenMetadata(BaseModel):
  index_id: str
  index_name: str
  horizon_trading_days: int
  universe_size: int
  analyzed_count: int
  positive_count: int
  unavailable_symbols: list[str]
  provider: str
  backend: str
  model: str
  model_version: str
  generated_at: datetime


class IndexScreenResponse(BaseModel):
  results: list[IndexScreenResult]
  metadata: IndexScreenMetadata
  disclaimer: str


class BacktestRequest(SecurityRequest):
  pass


class BacktestPoint(BaseModel):
  date: date
  actual: float = Field(gt=0)
  p10: float = Field(gt=0)
  p50: float = Field(gt=0)
  p90: float = Field(gt=0)


class BacktestMetadata(BaseModel):
  holdout_sessions: int
  context_observations: int
  context_start_date: date
  context_end_date: date
  provider: str
  backend: str
  model: str
  model_version: str
  preprocessing_version: str = "1"
  generated_at: datetime
  is_data_stale: bool


class BacktestResponse(BaseModel):
  backtest_id: str
  security: Security
  points: list[BacktestPoint]
  metrics: BacktestMetrics
  metadata: BacktestMetadata
  disclaimer: str


class TrackingOutlook(BaseModel):
  date: date
  p10: float = Field(gt=0)
  p50: float = Field(gt=0)
  p90: float = Field(gt=0)
  generated_at: datetime

  @model_validator(mode="after")
  def validate_quantile_order(self) -> "TrackingOutlook":
    if not self.p10 <= self.p50 <= self.p90:
      raise ValueError("Tracking outlook quantiles must satisfy p10 <= p50 <= p90.")
    return self


class WatchlistItem(BaseModel):
  security: Security
  latest_close: float = Field(gt=0)
  last_market_date: date
  added_at: datetime


class PortfolioPosition(BaseModel):
  security: Security
  quantity: float = Field(gt=0)
  average_price: float = Field(gt=0)
  latest_close: float = Field(gt=0)
  last_market_date: date
  outlooks: dict[Literal["7", "20", "60"], TrackingOutlook] = Field(
      default_factory=dict
  )
  updated_at: datetime


class PortfolioPriceSnapshot(BaseModel):
  date: date
  adjusted_close: float = Field(gt=0)
  captured_at: datetime


class PortfolioPositionResponse(PortfolioPosition):
  price_history: list[PortfolioPriceSnapshot] = Field(default_factory=list)


class TrackingState(BaseModel):
  watchlist: list[WatchlistItem] = Field(default_factory=list, max_length=20)
  positions: list[PortfolioPosition] = Field(default_factory=list, max_length=20)

  @model_validator(mode="after")
  def validate_unique_symbols(self) -> "TrackingState":
    watchlist_symbols = [item.security.symbol for item in self.watchlist]
    position_symbols = [item.security.symbol for item in self.positions]
    if len(watchlist_symbols) != len(set(watchlist_symbols)):
      raise ValueError("Watchlist symbols must be unique.")
    if len(position_symbols) != len(set(position_symbols)):
      raise ValueError("Portfolio position symbols must be unique.")
    return self


class TrackingStateResponse(BaseModel):
  watchlist: list[WatchlistItem] = Field(default_factory=list, max_length=20)
  positions: list[PortfolioPositionResponse] = Field(
      default_factory=list,
      max_length=20,
  )
  updated_at: datetime | None = None


class ErrorBody(BaseModel):
  code: str
  message: str
  retryable: bool
  request_id: str
  details: dict[str, object] | None = None


class ErrorResponse(BaseModel):
  error: ErrorBody
