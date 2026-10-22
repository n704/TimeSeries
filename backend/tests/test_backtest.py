from datetime import date, timedelta

from app.schemas import BacktestPoint
from app.services.backtest import evaluate_backtest


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
