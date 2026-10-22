from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.fakes import (
    FakeForecastModel,
    FakeMarketDataProvider,
    FakeTrackingStore,
    FakeTradingCalendar,
)


def make_client(history_count: int = 150) -> TestClient:
  app = create_app(
      settings=Settings(app_env="test", min_history_observations=120),
      market_data_provider=FakeMarketDataProvider(history_count),
      forecast_model=FakeForecastModel(),
      trading_calendar=FakeTradingCalendar(),
      tracking_store=FakeTrackingStore(),
  )
  return TestClient(app)


def test_search_and_history_contracts() -> None:
  with make_client() as client:
    search = client.get("/api/v1/securities/search", params={"q": "Reliance"})
    history = client.get(
        "/api/v1/securities/RELIANCE.NS/history",
        params={"range": "1y"},
    )

  assert search.status_code == 200
  assert search.json()["results"][0] == {
      "symbol": "RELIANCE.NS",
      "name": "Reliance Industries Limited",
      "exchange": "NSE",
      "region": "India",
      "currency": "INR",
      "instrument_type": "common_stock",
      "timezone": "Asia/Kolkata",
  }
  assert history.status_code == 200
  assert len(history.json()["prices"]) == 150
  assert history.json()["metadata"]["provider"] == "Fixture"


def test_tracking_state_persists_through_api() -> None:
  payload = {
      "watchlist": [
          {
              "security": {
                  "symbol": "RELIANCE.NS",
                  "name": "Reliance Industries Limited",
                  "exchange": "NSE",
                  "region": "India",
                  "currency": "INR",
                  "instrument_type": "common_stock",
                  "timezone": "Asia/Kolkata",
              },
              "latest_close": 1211.2,
              "last_market_date": "2026-10-16",
              "added_at": "2026-10-18T00:00:00Z",
          }
      ],
      "positions": [
          {
              "security": {
                  "symbol": "RELIANCE.NS",
                  "name": "Reliance Industries Limited",
                  "exchange": "NSE",
                  "region": "India",
                  "currency": "INR",
                  "instrument_type": "common_stock",
                  "timezone": "Asia/Kolkata",
              },
              "quantity": 3,
              "average_price": 1000,
              "latest_close": 1211.2,
              "last_market_date": "2026-10-16",
              "outlooks": {
                  "20": {
                      "date": "2026-11-16",
                      "p10": 1180,
                      "p50": 1250,
                      "p90": 1320,
                      "generated_at": "2026-10-18T00:00:00Z",
                  }
              },
              "updated_at": "2026-10-18T00:00:00Z",
          }
      ],
  }

  with make_client() as client:
    saved = client.put("/api/v1/tracking", json=payload)
    loaded = client.get("/api/v1/tracking")

  assert saved.status_code == 200
  assert saved.json()["updated_at"] == "2026-10-18T00:00:00Z"
  assert loaded.status_code == 200
  assert loaded.json()["watchlist"] == payload["watchlist"]
  assert loaded.json()["positions"] == payload["positions"]


def test_tracking_state_rejects_invalid_quantiles() -> None:
  payload = {
      "watchlist": [],
      "positions": [
          {
              "security": {
                  "symbol": "RELIANCE.NS",
                  "name": "Reliance Industries Limited",
                  "exchange": "NSE",
                  "region": "India",
                  "currency": "INR",
                  "instrument_type": "common_stock",
              },
              "quantity": 3,
              "average_price": 1000,
              "latest_close": 1211.2,
              "last_market_date": "2026-10-16",
              "outlooks": {
                  "20": {
                      "date": "2026-11-16",
                      "p10": 1300,
                      "p50": 1250,
                      "p90": 1200,
                      "generated_at": "2026-10-18T00:00:00Z",
                  }
              },
              "updated_at": "2026-10-18T00:00:00Z",
          }
      ],
  }

  with make_client() as client:
    response = client.put("/api/v1/tracking", json=payload)

  assert response.status_code == 422
  assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_forecast_contract_contains_chart_data_and_analysis() -> None:
  with make_client() as client:
    response = client.post(
        "/api/v1/forecasts",
        json={"symbol": "RELIANCE.NS", "horizon": 20},
    )

  assert response.status_code == 200
  payload = response.json()
  assert len(payload["history"]) == 120
  assert len(payload["forecast"]) == 20
  assert payload["forecast"][0]["p10"] < payload["forecast"][0]["p50"]
  assert payload["forecast"][0]["p50"] < payload["forecast"][0]["p90"]
  assert payload["analysis"]["trend"] == "upward"
  assert payload["analysis"]["recent_trend"] == "upward"
  assert payload["analysis"]["trend_alignment"] == "aligned"
  assert payload["analysis"]["evidence_level"] == "supportive"
  assert payload["analysis"]["historical_evaluation"] == {
      "holdout_sessions": 7,
      "context_end_date": "2026-05-23",
      "metrics": {
          "mean_absolute_error": 0.0,
          "mean_absolute_percentage_error": 0.0,
          "interval_coverage_percent": 100.0,
          "directional_accuracy_percent": 100.0,
          "end_direction_match": True,
      },
  }
  assert payload["metadata"]["backend"] == "fixture"
  assert "financial advice" in payload["disclaimer"]


def test_forecast_rejects_insufficient_history() -> None:
  with make_client(history_count=25) as client:
    response = client.post(
        "/api/v1/forecasts",
        json={"symbol": "RELIANCE.NS", "horizon": 5},
    )

  assert response.status_code == 422
  assert response.json()["error"]["code"] == "INSUFFICIENT_HISTORY"
  assert response.json()["error"]["details"] == {
      "required_observations": 120,
      "available_observations": 25,
  }


def test_forecast_remains_available_without_enough_backtest_history() -> None:
  with make_client(history_count=123) as client:
    response = client.post(
        "/api/v1/forecasts",
        json={"symbol": "RELIANCE.NS", "horizon": 5},
    )

  assert response.status_code == 200
  analysis = response.json()["analysis"]
  assert analysis["historical_evaluation"] is None
  assert analysis["evidence_level"] == "limited"


def test_invalid_horizon_uses_public_error_shape() -> None:
  with make_client() as client:
    response = client.post(
        "/api/v1/forecasts",
        json={"symbol": "RELIANCE.NS", "horizon": 7},
    )

  assert response.status_code == 422
  payload = response.json()["error"]
  assert payload["code"] == "INVALID_REQUEST"
  assert payload["request_id"].startswith("req_")


def test_forecast_accepts_canonical_indian_symbol_with_ampersand() -> None:
  with make_client() as client:
    response = client.post(
        "/api/v1/forecasts",
        json={"symbol": "M&M.NS", "horizon": 5},
    )

  assert response.status_code == 200


def test_index_screen_returns_top_five_positive_forecasts() -> None:
  with make_client() as client:
    response = client.post(
        "/api/v1/research/indexes/screen",
        json={"index_id": "nifty50", "horizon": 20},
    )

  assert response.status_code == 200
  payload = response.json()
  assert len(payload["results"]) == 5
  assert [result["rank"] for result in payload["results"]] == [1, 2, 3, 4, 5]
  assert all(result["forecast_change_percent"] > 0 for result in payload["results"])
  assert payload["metadata"]["universe_size"] == 50
  assert payload["metadata"]["index_name"] == "NIFTY 50"
  assert payload["metadata"]["analyzed_count"] == 50
  assert payload["metadata"]["positive_count"] == 50
  assert payload["metadata"]["unavailable_symbols"] == []
  assert "not a buy, sell, or hold recommendation" in payload["disclaimer"]


def test_midcap_select_screen_uses_its_25_stock_universe() -> None:
  with make_client() as client:
    response = client.post(
        "/api/v1/research/indexes/screen",
        json={"index_id": "nifty_midcap_select", "horizon": 20},
    )

  assert response.status_code == 200
  payload = response.json()
  assert len(payload["results"]) == 5
  assert payload["metadata"]["index_name"] == "NIFTY MIDCAP SELECT"
  assert payload["metadata"]["universe_size"] == 25
  assert payload["metadata"]["analyzed_count"] == 25


def test_backtest_predicts_last_seven_sessions_from_prior_history() -> None:
  with make_client() as client:
    response = client.post(
        "/api/v1/backtests",
        json={"symbol": "RELIANCE.NS"},
    )

  assert response.status_code == 200
  payload = response.json()
  assert payload["backtest_id"].startswith("bt_")
  assert len(payload["points"]) == 7
  assert all(point["actual"] == point["p50"] for point in payload["points"])
  assert payload["metrics"] == {
      "mean_absolute_error": 0.0,
      "mean_absolute_percentage_error": 0.0,
      "interval_coverage_percent": 100.0,
      "directional_accuracy_percent": 100.0,
      "end_direction_match": True,
  }
  assert payload["metadata"]["holdout_sessions"] == 7
  assert payload["metadata"]["context_observations"] == 143
  assert payload["metadata"]["context_end_date"] == "2026-05-23"
  assert "holdout" in payload["disclaimer"]


def test_backtest_requires_history_before_the_holdout() -> None:
  with make_client(history_count=126) as client:
    response = client.post(
        "/api/v1/backtests",
        json={"symbol": "RELIANCE.NS"},
    )

  assert response.status_code == 422
  assert response.json()["error"]["details"] == {
      "required_observations": 127,
      "available_observations": 126,
  }


def test_api_stays_live_and_provider_closes_when_model_startup_fails() -> None:
  class FailingModel(FakeForecastModel):
    async def load(self) -> None:
      raise RuntimeError("model load failed")

  provider = FakeMarketDataProvider()
  app = create_app(
      settings=Settings(app_env="test"),
      market_data_provider=provider,
      forecast_model=FailingModel(),
      trading_calendar=FakeTradingCalendar(),
      tracking_store=FakeTrackingStore(),
  )

  with TestClient(app) as client:
    liveness = client.get("/health/live")
    readiness = client.get("/health/ready")
    search = client.get("/api/v1/securities/search", params={"q": "Reliance"})
    forecast = client.post(
        "/api/v1/forecasts",
        json={"symbol": "RELIANCE.NS", "horizon": 5},
    )
    backtest = client.post(
        "/api/v1/backtests",
        json={"symbol": "RELIANCE.NS"},
    )
    screen = client.post(
        "/api/v1/research/indexes/screen",
        json={"index_id": "nifty_next50", "horizon": 20},
    )

  assert liveness.status_code == 200
  assert readiness.status_code == 503
  assert search.status_code == 200
  assert forecast.status_code == 503
  assert forecast.json()["error"]["code"] == "MODEL_NOT_READY"
  assert backtest.status_code == 503
  assert backtest.json()["error"]["code"] == "MODEL_NOT_READY"
  assert screen.status_code == 503
  assert screen.json()["error"]["code"] == "MODEL_NOT_READY"
  assert provider.history_calls == 0
  assert provider.closed
