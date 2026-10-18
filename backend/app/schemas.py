from datetime import date, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


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


class Analysis(BaseModel):
  latest_close: float
  forecast_end: float
  forecast_change_percent: float
  historical_change_5d_percent: float | None
  historical_change_20d_percent: float | None
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


class BacktestMetrics(BaseModel):
  mean_absolute_error: float = Field(ge=0)
  mean_absolute_percentage_error: float = Field(ge=0)
  interval_coverage_percent: float = Field(ge=0, le=100)


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


class ErrorBody(BaseModel):
  code: str
  message: str
  retryable: bool
  request_id: str
  details: dict[str, object] | None = None


class ErrorResponse(BaseModel):
  error: ErrorBody
