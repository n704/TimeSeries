from datetime import date, timedelta

from app.schemas import ForecastPoint, PricePoint
from app.services.analysis import analyze_forecast


def test_analysis_calculates_metrics_and_upward_summary() -> None:
  history = [
      PricePoint(
          date=date(2026, 1, 1) + timedelta(days=index),
          adjusted_close=100 + index,
      )
      for index in range(60)
  ]
  forecast = [
      ForecastPoint(
          date=date(2026, 4, 1) + timedelta(days=index),
          p10=158 + index,
          p50=162 + index,
          p90=166 + index,
      )
      for index in range(5)
  ]

  analysis = analyze_forecast(history, forecast)

  assert analysis.trend == "upward"
  assert analysis.latest_close == 159
  assert analysis.forecast_end == 166
  assert analysis.forecast_change_percent == 4.4
  assert analysis.historical_change_5d_percent == 3.25
  assert analysis.sma_20 == 149.5
  assert "above the latest adjusted close" in analysis.summary


def test_analysis_labels_small_change_as_flat() -> None:
  history = [
      PricePoint(date=date(2026, 1, 1), adjusted_close=100),
      PricePoint(date=date(2026, 1, 2), adjusted_close=100),
  ]
  forecast = [
      ForecastPoint(date=date(2026, 1, 5), p10=95, p50=100.5, p90=106)
  ]

  analysis = analyze_forecast(history, forecast)

  assert analysis.trend == "mostly_flat"
  assert analysis.historical_change_5d_percent is None
  assert analysis.sma_20 is None
  assert "near the latest adjusted close" in analysis.summary
