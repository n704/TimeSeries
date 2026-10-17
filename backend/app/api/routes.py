from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

import numpy as np
from fastapi import APIRouter, Query, Request

from app.errors import AppError
from app.providers.base import MarketDataProvider
from app.schemas import (
    BacktestMetadata,
    BacktestPoint,
    BacktestRequest,
    BacktestResponse,
    ForecastMetadata,
    ForecastPoint,
    ForecastRequest,
    ForecastResponse,
    HistoryResponse,
    SearchResponse,
)
from app.services.analysis import analyze_forecast
from app.services.backtest import evaluate_backtest
from app.services.calendar import TradingCalendar
from app.services.forecast import ForecastModel

router = APIRouter(prefix="/api/v1")
DISPLAY_PERIODS = {
    "6m": "6mo",
    "1y": "1y",
    "2y": "2y",
    "5y": "5y",
}
DISCLAIMER = (
    "This forecast is an uncertain statistical estimate for informational "
    "purposes only and is not financial advice."
)
BACKTEST_SESSIONS = 7
BACKTEST_DISCLAIMER = (
    "This historical back-check measures one seven-session holdout and does not "
    "guarantee future forecasting performance or provide financial advice."
)


def _provider(request: Request) -> MarketDataProvider:
  return request.app.state.market_data_provider


def _model(request: Request) -> ForecastModel:
  return request.app.state.forecast_model


def _calendar(request: Request) -> TradingCalendar:
  return request.app.state.trading_calendar


def _require_model_ready(request: Request) -> None:
  if not request.app.state.model_ready:
    raise AppError(
        "MODEL_NOT_READY",
        "TimesFM is not loaded. Check the backend model configuration.",
        status_code=503,
        retryable=True,
    )


@router.get("/securities/search", response_model=SearchResponse)
async def search_securities(
    request: Request,
    q: str = Query(min_length=2, max_length=64),
    limit: int = Query(default=8, ge=1, le=20),
) -> SearchResponse:
  query = q.strip()
  if len(query) < 2:
    raise AppError(
        "INVALID_REQUEST",
        "Search text must contain at least two characters.",
        status_code=400,
    )
  return SearchResponse(results=await _provider(request).search(query, limit))


@router.get("/securities/{symbol}/history", response_model=HistoryResponse)
async def security_history(
    symbol: str,
    request: Request,
    range: Literal["6m", "1y", "2y", "5y"] = "1y",
) -> HistoryResponse:
  data = await _provider(request).history(symbol.upper(), DISPLAY_PERIODS[range])
  return HistoryResponse(
      security=data.security,
      prices=data.prices,
      metadata=data.metadata,
  )


@router.post("/forecasts", response_model=ForecastResponse)
async def create_forecast(
    body: ForecastRequest,
    request: Request,
) -> ForecastResponse:
  _require_model_ready(request)
  history = await _provider(request).history(body.symbol.upper(), "5y")
  minimum = request.app.state.settings.min_history_observations
  if len(history.prices) < minimum:
    raise AppError(
        "INSUFFICIENT_HISTORY",
        f"{body.symbol.upper()} does not have enough valid daily history.",
        status_code=422,
        details={
            "required_observations": minimum,
            "available_observations": len(history.prices),
        },
    )

  context = np.asarray(
      [point.adjusted_close for point in history.prices],
      dtype=np.float32,
  )
  output = await _model(request).predict(context, body.horizon)
  forecast_dates = _calendar(request).next_sessions(
      history.security.exchange,
      history.prices[-1].date,
      body.horizon,
  )
  points = [
      ForecastPoint(date=session, p10=p10, p50=p50, p90=p90)
      for session, p10, p50, p90 in zip(
          forecast_dates,
          output.p10,
          output.p50,
          output.p90,
          strict=True,
      )
  ]
  model = _model(request)
  return ForecastResponse(
      forecast_id=f"fc_{uuid4().hex}",
      security=history.security,
      history=history.prices[-120:],
      forecast=points,
      analysis=analyze_forecast(history.prices, points),
      metadata=ForecastMetadata(
          horizon_trading_days=body.horizon,
          context_observations=len(history.prices),
          context_start_date=history.prices[0].date,
          context_end_date=history.prices[-1].date,
          provider=history.metadata.provider,
          backend=model.backend_name,
          model=model.model_id,
          model_version=model.model_version,
          generated_at=datetime.now(UTC),
          is_data_stale=history.metadata.is_stale,
      ),
      disclaimer=DISCLAIMER,
  )


@router.post("/backtests", response_model=BacktestResponse)
async def create_backtest(
    body: BacktestRequest,
    request: Request,
) -> BacktestResponse:
  _require_model_ready(request)
  history = await _provider(request).history(body.symbol.upper(), "5y")
  required = request.app.state.settings.min_history_observations + BACKTEST_SESSIONS
  if len(history.prices) < required:
    raise AppError(
        "INSUFFICIENT_HISTORY",
        f"{body.symbol.upper()} does not have enough valid daily history "
        "for a seven-session back-check.",
        status_code=422,
        details={
            "required_observations": required,
            "available_observations": len(history.prices),
        },
    )

  context_prices = history.prices[:-BACKTEST_SESSIONS]
  actual_prices = history.prices[-BACKTEST_SESSIONS:]
  context = np.asarray(
      [point.adjusted_close for point in context_prices],
      dtype=np.float32,
  )
  output = await _model(request).predict(context, BACKTEST_SESSIONS)
  points = [
      BacktestPoint(
          date=actual.date,
          actual=actual.adjusted_close,
          p10=p10,
          p50=p50,
          p90=p90,
      )
      for actual, p10, p50, p90 in zip(
          actual_prices,
          output.p10,
          output.p50,
          output.p90,
          strict=True,
      )
  ]
  model = _model(request)
  return BacktestResponse(
      backtest_id=f"bt_{uuid4().hex}",
      security=history.security,
      points=points,
      metrics=evaluate_backtest(points),
      metadata=BacktestMetadata(
          holdout_sessions=BACKTEST_SESSIONS,
          context_observations=len(context_prices),
          context_start_date=context_prices[0].date,
          context_end_date=context_prices[-1].date,
          provider=history.metadata.provider,
          backend=model.backend_name,
          model=model.model_id,
          model_version=model.model_version,
          generated_at=datetime.now(UTC),
          is_data_stale=history.metadata.is_stale,
      ),
      disclaimer=BACKTEST_DISCLAIMER,
  )
