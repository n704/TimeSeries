from datetime import UTC, datetime

import pytest

from app.errors import AppError
from app.providers.yahoo import YahooMarketDataProvider


@pytest.fixture
def anyio_backend() -> str:
  return "asyncio"


@pytest.mark.anyio
async def test_search_returns_only_nse_and_bse_equities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
  provider = YahooMarketDataProvider()

  async def fake_get_json(*args: object, **kwargs: object) -> dict[str, object]:
    return {
        "quotes": [
            {
                "quoteType": "EQUITY",
                "exchange": "NSI",
                "symbol": "RELIANCE.NS",
                "longname": "Reliance Industries Limited",
            },
            {
                "quoteType": "EQUITY",
                "exchange": "NYQ",
                "symbol": "RS",
                "longname": "Reliance, Inc.",
            },
            {
                "quoteType": "EQUITY",
                "exchange": "BSE",
                "symbol": "RELIANCE.BO",
                "longname": "Reliance Industries Limited",
            },
        ]
    }

  monkeypatch.setattr(provider, "_get_json", fake_get_json)
  try:
    results = await provider.search("Reliance", 8)
  finally:
    await provider.close()

  assert [result.symbol for result in results] == ["RELIANCE.NS", "RELIANCE.BO"]
  assert [(result.exchange, result.currency) for result in results] == [
      ("NSE", "INR"),
      ("BSE", "INR"),
  ]
  assert all(result.region == "India" for result in results)
  assert all(result.timezone == "Asia/Kolkata" for result in results)


@pytest.mark.anyio
async def test_history_normalizes_indian_equity_and_ignores_non_finite_prices(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
  provider = YahooMarketDataProvider()
  timestamp = int(datetime(2026, 10, 16, tzinfo=UTC).timestamp())

  async def fake_get_json(*args: object, **kwargs: object) -> dict[str, object]:
    return {
        "chart": {
            "result": [
                {
                    "meta": {
                        "currency": "INR",
                        "symbol": "RELIANCE.NS",
                        "exchangeName": "NSI",
                        "instrumentType": "EQUITY",
                        "longName": "Reliance Industries Limited",
                        "exchangeTimezoneName": "Asia/Kolkata",
                    },
                    "timestamp": [timestamp, timestamp + 86_400],
                    "indicators": {
                        "adjclose": [{"adjclose": [1210.5, float("nan")]}],
                        "quote": [{"close": [1210.5, 1211.0]}],
                    },
                }
            ],
            "error": None,
        }
    }

  monkeypatch.setattr(provider, "_get_json", fake_get_json)
  try:
    history = await provider.history("RELIANCE.NS", "1y")
  finally:
    await provider.close()

  assert history.security.symbol == "RELIANCE.NS"
  assert history.security.exchange == "NSE"
  assert history.security.region == "India"
  assert history.security.currency == "INR"
  assert [point.adjusted_close for point in history.prices] == [1210.5]


@pytest.mark.anyio
async def test_history_rejects_non_indian_listing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
  provider = YahooMarketDataProvider()

  async def fake_get_json(*args: object, **kwargs: object) -> dict[str, object]:
    return {
        "chart": {
            "result": [
                {
                    "meta": {
                        "symbol": "AAPL",
                        "exchangeName": "NMS",
                        "instrumentType": "EQUITY",
                    }
                }
            ],
            "error": None,
        }
    }

  monkeypatch.setattr(provider, "_get_json", fake_get_json)
  try:
    with pytest.raises(AppError, match="supported Indian common-stock"):
      await provider.history("AAPL", "1y")
  finally:
    await provider.close()
