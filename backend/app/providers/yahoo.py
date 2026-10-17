import asyncio
from datetime import UTC, date, datetime
from typing import Any
from urllib.parse import quote

import httpx

from app.errors import AppError, ProviderError
from app.providers.base import HistoryData
from app.schemas import HistoryMetadata, InstrumentType, PricePoint, Security

SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"
CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart"
SUPPORTED_EXCHANGES = {
    "ASE": "NYSE American",
    "BTS": "NYSE Arca",
    "NCM": "NASDAQ",
    "NGM": "NASDAQ",
    "NMS": "NASDAQ",
    "NYQ": "NYSE",
    "PCX": "NYSE Arca",
}


class YahooMarketDataProvider:
  name = "Yahoo Finance"

  def __init__(self, timeout_seconds: float = 15) -> None:
    self._client = httpx.AsyncClient(
        timeout=httpx.Timeout(timeout_seconds),
        headers={"User-Agent": "TimeSeriesLocal/0.1"},
        follow_redirects=True,
    )

  async def search(self, query: str, limit: int) -> list[Security]:
    payload = await self._get_json(
        SEARCH_URL,
        params={
            "q": query,
            "quotesCount": min(limit * 2, 40),
            "newsCount": 0,
            "enableFuzzyQuery": "false",
        },
    )
    results: list[Security] = []
    for quote_data in payload.get("quotes", []):
      if quote_data.get("quoteType") != "EQUITY":
        continue
      exchange_code = str(quote_data.get("exchange", ""))
      if exchange_code not in SUPPORTED_EXCHANGES:
        continue
      symbol = quote_data.get("symbol")
      name = quote_data.get("longname") or quote_data.get("shortname")
      if not symbol or not name:
        continue
      results.append(
          Security(
              symbol=str(symbol).upper(),
              name=str(name),
              exchange=SUPPORTED_EXCHANGES[exchange_code],
              currency=str(quote_data.get("currency") or "USD"),
              instrument_type=InstrumentType.COMMON_STOCK,
          )
      )
      if len(results) == limit:
        break
    return results

  async def history(self, symbol: str, period: str) -> HistoryData:
    payload = await self._get_json(
        f"{CHART_URL}/{quote(symbol.upper(), safe='')}",
        params={
            "range": period,
            "interval": "1d",
            "events": "div,splits",
            "includeAdjustedClose": "true",
        },
    )
    chart = payload.get("chart", {})
    error = chart.get("error")
    results = chart.get("result") or []
    if error or not results:
      raise AppError(
          "SECURITY_NOT_FOUND",
          f"No supported stock was found for {symbol.upper()}.",
          status_code=404,
      )

    result = results[0]
    meta = result.get("meta", {})
    exchange_name = str(meta.get("exchangeName", ""))
    if exchange_name not in SUPPORTED_EXCHANGES:
      raise AppError(
          "UNSUPPORTED_SECURITY",
          f"{symbol.upper()} is not a supported U.S. common-stock listing.",
          status_code=422,
      )

    timestamps = result.get("timestamp") or []
    indicators = result.get("indicators") or {}
    adjusted = (indicators.get("adjclose") or [{}])[0].get("adjclose") or []
    closes = (indicators.get("quote") or [{}])[0].get("close") or []
    values = adjusted if adjusted else closes

    prices_by_date: dict[date, PricePoint] = {}
    for timestamp, value in zip(timestamps, values, strict=False):
      if not isinstance(value, (int, float)) or value <= 0:
        continue
      market_date = datetime.fromtimestamp(timestamp, tz=UTC).date()
      prices_by_date[market_date] = PricePoint(
          date=market_date,
          adjusted_close=float(value),
      )
    prices = sorted(prices_by_date.values(), key=lambda point: point.date)
    if not prices:
      raise ProviderError(f"{symbol.upper()} returned no valid daily prices.")

    now = datetime.now(UTC)
    last_market_date = prices[-1].date
    security = Security(
        symbol=str(meta.get("symbol") or symbol).upper(),
        name=str(meta.get("longName") or meta.get("shortName") or symbol.upper()),
        exchange=SUPPORTED_EXCHANGES[exchange_name],
        currency=str(meta.get("currency") or "USD"),
        timezone=str(meta.get("exchangeTimezoneName") or "America/New_York"),
    )
    return HistoryData(
        security=security,
        prices=prices,
        metadata=HistoryMetadata(
            provider=self.name,
            retrieved_at=now,
            last_market_date=last_market_date,
            is_stale=(now.date() - last_market_date).days > 5,
        ),
    )

  async def close(self) -> None:
    await self._client.aclose()

  async def _get_json(
      self,
      url: str,
      *,
      params: dict[str, object],
  ) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(3):
      try:
        response = await self._client.get(url, params=params)
        if response.status_code == 429:
          if attempt == 2:
            raise AppError(
                "DATA_PROVIDER_RATE_LIMITED",
                "The market-data provider is temporarily rate limited.",
                status_code=503,
                retryable=True,
            )
          await asyncio.sleep(0.25 * (2**attempt))
          continue
        response.raise_for_status()
        return response.json()
      except AppError:
        raise
      except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as error:
        last_error = error
        status = (
            error.response.status_code
            if isinstance(error, httpx.HTTPStatusError)
            else None
        )
        if attempt == 2 or status not in {None, 502, 503, 504}:
          break
        await asyncio.sleep(0.25 * (2**attempt))
    raise ProviderError("The market-data provider could not be reached.") from last_error
