import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.fakes import (
    FakeForecastModel,
    FakeMarketDataProvider,
    FakeTradingCalendar,
)


def make_client(history_count: int = 150) -> TestClient:
  app = create_app(
      settings=Settings(app_env="test", min_history_observations=120),
      market_data_provider=FakeMarketDataProvider(history_count),
      forecast_model=FakeForecastModel(),
      trading_calendar=FakeTradingCalendar(),
  )
  return TestClient(app)


def test_search_and_history_contracts() -> None:
  with make_client() as client:
    search = client.get("/api/v1/securities/search", params={"q": "Apple"})
    history = client.get("/api/v1/securities/AAPL/history", params={"range": "1y"})

  assert search.status_code == 200
  assert search.json()["results"][0]["symbol"] == "AAPL"
  assert history.status_code == 200
  assert len(history.json()["prices"]) == 150
  assert history.json()["metadata"]["provider"] == "Fixture"


def test_forecast_contract_contains_chart_data_and_analysis() -> None:
  with make_client() as client:
    response = client.post(
        "/api/v1/forecasts",
        json={"symbol": "AAPL", "horizon": 20},
    )

  assert response.status_code == 200
  payload = response.json()
  assert len(payload["history"]) == 120
  assert len(payload["forecast"]) == 20
  assert payload["forecast"][0]["p10"] < payload["forecast"][0]["p50"]
  assert payload["forecast"][0]["p50"] < payload["forecast"][0]["p90"]
  assert payload["analysis"]["trend"] == "upward"
  assert payload["metadata"]["backend"] == "fixture"
  assert "financial advice" in payload["disclaimer"]


def test_forecast_rejects_insufficient_history() -> None:
  with make_client(history_count=25) as client:
    response = client.post(
        "/api/v1/forecasts",
        json={"symbol": "AAPL", "horizon": 5},
    )

  assert response.status_code == 422
  assert response.json()["error"]["code"] == "INSUFFICIENT_HISTORY"
  assert response.json()["error"]["details"] == {
      "required_observations": 120,
      "available_observations": 25,
  }


def test_invalid_horizon_uses_public_error_shape() -> None:
  with make_client() as client:
    response = client.post(
        "/api/v1/forecasts",
        json={"symbol": "AAPL", "horizon": 7},
    )

  assert response.status_code == 422
  payload = response.json()["error"]
  assert payload["code"] == "INVALID_REQUEST"
  assert payload["request_id"].startswith("req_")


def test_provider_closes_when_model_startup_fails() -> None:
  class FailingModel(FakeForecastModel):
    async def load(self) -> None:
      raise RuntimeError("model load failed")

  provider = FakeMarketDataProvider()
  app = create_app(
      settings=Settings(app_env="test"),
      market_data_provider=provider,
      forecast_model=FailingModel(),
      trading_calendar=FakeTradingCalendar(),
  )

  with pytest.raises(RuntimeError, match="model load failed"):
    with TestClient(app):
      pass

  assert provider.closed
