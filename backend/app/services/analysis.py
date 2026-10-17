from collections.abc import Sequence

from app.schemas import Analysis, ForecastPoint, PricePoint


def _percent_change(start: float, end: float) -> float:
  return ((end / start) - 1) * 100


def _rounded(value: float) -> float:
  return round(value, 2)


def _historical_change(prices: Sequence[PricePoint], sessions: int) -> float | None:
  if len(prices) <= sessions:
    return None
  return _rounded(
      _percent_change(prices[-sessions - 1].adjusted_close, prices[-1].adjusted_close)
  )


def _moving_average(prices: Sequence[PricePoint], sessions: int) -> float | None:
  if len(prices) < sessions:
    return None
  values = [point.adjusted_close for point in prices[-sessions:]]
  return _rounded(sum(values) / sessions)


def analyze_forecast(
    history: Sequence[PricePoint],
    forecast: Sequence[ForecastPoint],
) -> Analysis:
  if not history or not forecast:
    raise ValueError("History and forecast must not be empty.")

  latest_close = history[-1].adjusted_close
  forecast_end = forecast[-1].p50
  change = _rounded(_percent_change(latest_close, forecast_end))
  trend = "upward" if change > 1 else "downward" if change < -1 else "mostly_flat"
  interval_width = _rounded(
      ((forecast[-1].p90 - forecast[-1].p10) / forecast[-1].p50) * 100
  )
  direction_text = {
      "upward": "above",
      "downward": "below",
      "mostly_flat": "near",
  }[trend]
  summary = (
      f"TimesFM's median forecast is {abs(change):.1f}% {direction_text} the latest "
      f"adjusted close over the next {len(forecast)} trading sessions. The p10-p90 "
      "range shows uncertainty, which may widen further into the forecast."
  )
  return Analysis(
      latest_close=_rounded(latest_close),
      forecast_end=_rounded(forecast_end),
      forecast_change_percent=change,
      historical_change_5d_percent=_historical_change(history, 5),
      historical_change_20d_percent=_historical_change(history, 20),
      sma_20=_moving_average(history, 20),
      sma_50=_moving_average(history, 50),
      trend=trend,
      final_interval_width_percent=interval_width,
      summary=summary,
  )
