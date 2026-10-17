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
  region: str = "United States"
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


class ForecastRequest(BaseModel):
  symbol: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-^]+$")
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


class ErrorBody(BaseModel):
  code: str
  message: str
  retryable: bool
  request_id: str
  details: dict[str, object] | None = None


class ErrorResponse(BaseModel):
  error: ErrorBody
