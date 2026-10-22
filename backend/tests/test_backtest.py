from datetime import date, timedelta

import pytest

from app.schemas import BacktestPoint
from app.services.backtest import (
    apply_forecast_correction,
    calculate_forecast_correction,
    evaluate_backtest,
)
from app.services.forecast import ModelForecast


def test_backtest_measures_daily_and_end_direction_accuracy() -> None:
  points = [
      BacktestPoint(
          date=date(2026, 1, 1) + timedelta(days=index),
          actual=actual,
          p10=predicted - 2,
          p50=predicted,
          p90=predicted + 2,
      )
      for index, (actual, predicted) in enumerate(
          [(98, 101), (96, 99), (97, 103)]
      )
  ]

  metrics = evaluate_backtest(points, context_end_price=100)

  assert metrics.directional_accuracy_percent == 66.67
  assert metrics.end_direction_match is False


def test_latest_holdout_error_corrects_raw_next_day_forecast() -> None:
  points = [
      BacktestPoint(
          date=date(2026, 1, 1),
          actual=110,
          p10=100,
          p50=105,
          p90=110,
      ),
      BacktestPoint(
          date=date(2026, 1, 2),
          actual=100,
          p10=105,
          p50=112,
          p90=120,
      ),
  ]

  correction = calculate_forecast_correction(points)
  corrected = apply_forecast_correction(
      ModelForecast(p10=[100], p50=[110], p90=[120]),
      correction,
  )

  assert correction.reference_date == date(2026, 1, 2)
  assert correction.signed_median_error_percent == pytest.approx(12)
  assert correction.scale_factor == pytest.approx(100 / 112)
  assert corrected.p10 == pytest.approx([89.285714])
  assert corrected.p50 == pytest.approx([98.214286])
  assert corrected.p90 == pytest.approx([107.142857])
  assert corrected.p10[0] < corrected.p50[0] < corrected.p90[0]
  assert corrected.p50[0] < points[-1].actual
