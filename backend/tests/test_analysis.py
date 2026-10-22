from datetime import date, timedelta

from app.schemas import (
    BacktestMetrics,
    ForecastPoint,
    HistoricalEvaluation,
    PricePoint,
)
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

  analysis = analyze_forecast(
      history,
      forecast,
      HistoricalEvaluation(
          holdout_sessions=7,
          context_end_date=date(2026, 3, 1),
          metrics=BacktestMetrics(
              mean_absolute_error=1,
              mean_absolute_percentage_error=0.8,
              interval_coverage_percent=85.71,
              directional_accuracy_percent=85.71,
              end_direction_match=True,
          ),
      ),
  )

  assert analysis.trend == "upward"
  assert analysis.latest_close == 159
  assert analysis.forecast_end == 166
  assert analysis.forecast_change_percent == 4.4
  assert analysis.historical_change_5d_percent == 3.25
  assert analysis.recent_trend == "upward"
  assert analysis.trend_alignment == "aligned"
  assert analysis.evidence_level == "supportive"
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
  assert analysis.trend_alignment == "neutral"
  assert analysis.evidence_level == "limited"
  assert analysis.sma_20 is None
  assert "near the latest adjusted close" in analysis.summary


def test_analysis_limits_evidence_when_forecast_opposes_recent_decline() -> None:
  history = [
      PricePoint(
          date=date(2026, 1, 1) + timedelta(days=index),
          adjusted_close=108 - index,
      )
      for index in range(8)
  ]
  forecast = [
      ForecastPoint(date=date(2026, 1, 12), p10=99, p50=103, p90=107),
      ForecastPoint(date=date(2026, 1, 13), p10=101, p50=105, p90=109),
  ]
  evaluation = HistoricalEvaluation(
      holdout_sessions=7,
      context_end_date=date(2025, 12, 31),
      metrics=BacktestMetrics(
          mean_absolute_error=1,
          mean_absolute_percentage_error=0.8,
          interval_coverage_percent=100,
          directional_accuracy_percent=100,
          end_direction_match=True,
      ),
  )

  analysis = analyze_forecast(history, forecast, evaluation)

  assert analysis.trend == "upward"
  assert analysis.recent_trend == "downward"
  assert analysis.trend_alignment == "opposed"
  assert analysis.evidence_level == "limited"
  assert "points in the opposite direction" in analysis.summary
