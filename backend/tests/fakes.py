from datetime import UTC, date, datetime, timedelta

import numpy as np

from app.providers.base import HistoryData
from app.schemas import (
    HistoryMetadata,
    PricePoint,
    Security,
    TrackingState,
    TrackingStateResponse,
)
from app.services.forecast import ModelForecast


class FakeMarketDataProvider:
  def __init__(self, count: int = 150) -> None:
    self.closed = False
    self.history_calls = 0
    self.security = Security(
        symbol="RELIANCE.NS",
        name="Reliance Industries Limited",
        exchange="NSE",
        currency="INR",
        timezone="Asia/Kolkata",
    )
    start = date(2026, 1, 1)
    self.prices = [
        PricePoint(date=start + timedelta(days=index), adjusted_close=100 + index)
        for index in range(count)
    ]

  async def search(self, query: str, limit: int) -> list[Security]:
    return (
        [self.security]
        if query.lower() in {"re", "reliance", "reliance.ns"}
        else []
    )

  async def history(self, symbol: str, period: str) -> HistoryData:
    self.history_calls += 1
    security = self.security.model_copy(
        update={
            "symbol": symbol,
            "name": (
                self.security.name
                if symbol == self.security.symbol
                else symbol.removesuffix(".NS")
            ),
        }
    )
    return HistoryData(
        security=security,
        prices=self.prices,
        metadata=HistoryMetadata(
            provider="Fixture",
            retrieved_at=datetime(2026, 6, 1, tzinfo=UTC),
            last_market_date=self.prices[-1].date,
            is_stale=False,
        ),
    )

  async def close(self) -> None:
    self.closed = True


class FakeForecastModel:
  backend_name = "fixture"
  model_id = "fixture-timesfm"
  model_version = "test"

  async def load(self) -> None:
    return None

  async def predict(self, context: np.ndarray, horizon: int) -> ModelForecast:
    latest = float(context[-1])
    medians = [latest + index + 1 for index in range(horizon)]
    return ModelForecast(
        p10=[value * 0.95 for value in medians],
        p50=medians,
        p90=[value * 1.05 for value in medians],
    )

  async def predict_batch(
      self,
      contexts: list[np.ndarray],
      horizon: int,
  ) -> list[ModelForecast]:
    return [await self.predict(context, horizon) for context in contexts]


class FakeTradingCalendar:
  def next_sessions(self, exchange: str, after: date, count: int) -> list[date]:
    assert exchange == "NSE"
    return [after + timedelta(days=index + 1) for index in range(count)]


class FakeTrackingStore:
  def __init__(self) -> None:
    self.state = TrackingStateResponse()
    self.initialized = False

  async def initialize(self) -> None:
    self.initialized = True

  async def load(self) -> TrackingStateResponse:
    return self.state

  async def save(self, state: TrackingState) -> TrackingStateResponse:
    self.state = TrackingStateResponse(
        watchlist=state.watchlist,
        positions=state.positions,
        updated_at=datetime(2026, 10, 18, tzinfo=UTC),
    )
    return self.state
