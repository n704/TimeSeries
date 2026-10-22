import asyncio
from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

import numpy as np
from fastapi import APIRouter, Query, Request

from app.errors import AppError
from app.providers.base import HistoryData, MarketDataProvider
from app.schemas import (
    BacktestMetadata,
    BacktestPoint,
    BacktestRequest,
    BacktestResponse,
    ForecastMetadata,
    ForecastPoint,
    ForecastRequest,
    ForecastResponse,
    HistoricalEvaluation,
    HistoryResponse,
    IndexScreenMetadata,
    IndexScreenRequest,
    IndexScreenResponse,
    IndexScreenResult,
    SearchResponse,
    TrackingState,
    TrackingStateResponse,
)
from app.services.analysis import analyze_forecast
from app.services.backtest import (
    apply_forecast_bias,
    build_backtest_points,
    evaluate_backtest,
    forecast_bias,
)
from app.services.calendar import TradingCalendar
from app.services.forecast import ForecastModel
from app.services.indices import INDEX_UNIVERSES
from app.services.tracking import TrackingStore, TrackingStoreError

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
INDEX_SCREEN_DISCLAIMER = (
    "This ranking compares positive TimesFM median forecast changes for research "
    "only. It does not consider valuation, fundamentals, news, liquidity, risk, "
    "or personal circumstances and is not a buy, sell, or hold recommendation."
)
INDEX_HISTORY_CONCURRENCY = 5


def _provider(request: Request) -> MarketDataProvider:
  return request.app.state.market_data_provider


def _model(request: Request) -> ForecastModel:
  return request.app.state.forecast_model


def _calendar(request: Request) -> TradingCalendar:
  return request.app.state.trading_calendar


def _tracking_store(request: Request) -> TrackingStore:
  return request.app.state.tracking_store


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


@router.get("/tracking", response_model=TrackingStateResponse)
async def get_tracking_state(request: Request) -> TrackingStateResponse:
  try:
    return await _tracking_store(request).load()
  except TrackingStoreError as error:
    raise AppError(
        "TRACKING_STORAGE_ERROR",
        "Saved watchlist and portfolio data could not be loaded.",
        status_code=503,
        retryable=True,
    ) from error


@router.put("/tracking", response_model=TrackingStateResponse)
async def save_tracking_state(
    body: TrackingState,
    request: Request,
) -> TrackingStateResponse:
  try:
    return await _tracking_store(request).save(body)
  except TrackingStoreError as error:
    raise AppError(
        "TRACKING_STORAGE_ERROR",
        "Watchlist and portfolio changes could not be saved.",
        status_code=503,
        retryable=True,
    ) from error


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
  model = _model(request)
  output = await model.predict(context, body.horizon)
  historical_evaluation = None
  if len(history.prices) >= minimum + BACKTEST_SESSIONS:
    evaluation_context_prices = history.prices[:-BACKTEST_SESSIONS]
    evaluation_context = np.asarray(
        [point.adjusted_close for point in evaluation_context_prices],
        dtype=np.float32,
    )
    evaluation_output = await model.predict(
        evaluation_context,
        BACKTEST_SESSIONS,
    )
    evaluation_points = build_backtest_points(
        history.prices[-BACKTEST_SESSIONS:],
        evaluation_output,
    )
    historical_evaluation = HistoricalEvaluation(
        holdout_sessions=BACKTEST_SESSIONS,
        context_end_date=evaluation_context_prices[-1].date,
        metrics=evaluate_backtest(
            evaluation_points,
            evaluation_context_prices[-1].adjusted_close,
        ),
    )
    output = apply_forecast_bias(output, forecast_bias(evaluation_points))
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
  return ForecastResponse(
      forecast_id=f"fc_{uuid4().hex}",
      security=history.security,
      history=history.prices[-120:],
      forecast=points,
      analysis=analyze_forecast(
          history.prices,
          points,
          historical_evaluation,
      ),
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


@router.post(
    "/research/indexes/screen",
    response_model=IndexScreenResponse,
)
async def screen_index(
    body: IndexScreenRequest,
    request: Request,
) -> IndexScreenResponse:
  _require_model_ready(request)
  universe = INDEX_UNIVERSES[body.index_id]
  provider = _provider(request)
  semaphore = asyncio.Semaphore(INDEX_HISTORY_CONCURRENCY)

  async def load_history(symbol: str) -> tuple[str, HistoryData | None]:
    async with semaphore:
      try:
        return symbol, await provider.history(symbol, "5y")
      except AppError as error:
        if error.code in {"SECURITY_NOT_FOUND", "UNSUPPORTED_SECURITY"}:
          return symbol, None
        raise

  loaded = await asyncio.gather(
      *(load_history(symbol) for symbol in universe.symbols)
  )
  minimum = request.app.state.settings.min_history_observations
  histories: list[HistoryData] = []
  unavailable_symbols: list[str] = []
  for symbol, history in loaded:
    if history is None or len(history.prices) < minimum:
      unavailable_symbols.append(symbol)
    else:
      histories.append(history)

  if not histories:
    raise AppError(
        "INDEX_SCREEN_UNAVAILABLE",
        f"No {universe.name} constituents have enough valid daily history to compare.",
        status_code=422,
        details={
            "required_observations": minimum,
            "unavailable_symbols": unavailable_symbols,
        },
    )

  contexts = [
      np.asarray(
          [point.adjusted_close for point in history.prices],
          dtype=np.float32,
      )
      for history in histories
  ]
  model = _model(request)
  outputs = await model.predict_batch(contexts, body.horizon)
  correction_indices = [
      index
      for index, history in enumerate(histories)
      if len(history.prices) >= minimum + BACKTEST_SESSIONS
  ]
  if correction_indices:
    correction_contexts = [
        np.asarray(
            [point.adjusted_close for point in histories[index].prices[:-BACKTEST_SESSIONS]],
            dtype=np.float32,
        )
        for index in correction_indices
    ]
    correction_outputs = await model.predict_batch(
        correction_contexts,
        BACKTEST_SESSIONS,
    )
    for index, correction_output in zip(
        correction_indices,
        correction_outputs,
        strict=True,
    ):
      evaluation_points = build_backtest_points(
          histories[index].prices[-BACKTEST_SESSIONS:],
          correction_output,
      )
      outputs[index] = apply_forecast_bias(
          outputs[index],
          forecast_bias(evaluation_points),
      )
  candidates = []
  for history, output in zip(histories, outputs, strict=True):
    latest_close = history.prices[-1].adjusted_close
    final_p10 = output.p10[-1]
    final_p50 = output.p50[-1]
    final_p90 = output.p90[-1]
    change = ((final_p50 - latest_close) / latest_close) * 100
    if change <= 0:
      continue
    end_date = _calendar(request).next_sessions(
        history.security.exchange,
        history.prices[-1].date,
        body.horizon,
    )[-1]
    candidates.append(
        (
            change,
            history,
            end_date,
            final_p10,
            final_p50,
            final_p90,
        )
    )

  candidates.sort(key=lambda candidate: candidate[0], reverse=True)
  results = [
      IndexScreenResult(
          rank=rank,
          security=history.security,
          latest_close=history.prices[-1].adjusted_close,
          forecast_end=final_p50,
          forecast_change_percent=change,
          forecast_end_date=end_date,
          final_p10=final_p10,
          final_p50=final_p50,
          final_p90=final_p90,
          final_interval_width_percent=((final_p90 - final_p10) / final_p50) * 100,
          is_data_stale=history.metadata.is_stale,
      )
      for rank, (
          change,
          history,
          end_date,
          final_p10,
          final_p50,
          final_p90,
      ) in enumerate(candidates[:5], start=1)
  ]
  return IndexScreenResponse(
      results=results,
      metadata=IndexScreenMetadata(
          index_id=universe.index_id,
          index_name=universe.name,
          horizon_trading_days=body.horizon,
          universe_size=len(universe.symbols),
          analyzed_count=len(histories),
          positive_count=len(candidates),
          unavailable_symbols=unavailable_symbols,
          provider=histories[0].metadata.provider,
          backend=model.backend_name,
          model=model.model_id,
          model_version=model.model_version,
          generated_at=datetime.now(UTC),
      ),
      disclaimer=INDEX_SCREEN_DISCLAIMER,
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
  points = build_backtest_points(actual_prices, output)
  model = _model(request)
  return BacktestResponse(
      backtest_id=f"bt_{uuid4().hex}",
      security=history.security,
      points=points,
      metrics=evaluate_backtest(
          points,
          context_prices[-1].adjusted_close,
      ),
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
