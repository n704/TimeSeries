from datetime import UTC, date, datetime, timedelta

import numpy as np

from app.providers.base import HistoryData
from app.schemas import HistoryMetadata, PricePoint, Security
from app.services.forecast import ModelForecast


class FakeMarketDataProvider:
  def __init__(self, count: int = 150) -> None:
    self.closed = False
    self.security = Security(
        symbol="AAPL",
        name="Apple Inc.",
        exchange="NASDAQ",
        currency="USD",
        timezone="America/New_York",
    )
    start = date(2026, 1, 1)
    self.prices = [
        PricePoint(date=start + timedelta(days=index), adjusted_close=100 + index)
        for index in range(count)
    ]

  async def search(self, query: str, limit: int) -> list[Security]:
    return [self.security] if query.lower() in {"aa", "aapl", "apple"} else []

  async def history(self, symbol: str, period: str) -> HistoryData:
    return HistoryData(
        security=self.security,
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


class FakeTradingCalendar:
  def next_sessions(self, after: date, count: int) -> list[date]:
    return [after + timedelta(days=index + 1) for index in range(count)]
