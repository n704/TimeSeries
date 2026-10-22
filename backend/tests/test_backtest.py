from datetime import date, timedelta

from app.schemas import BacktestPoint
from app.services.backtest import apply_forecast_bias, evaluate_backtest, forecast_bias
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


def test_forecast_bias_shifts_future_quantiles_without_changing_spread() -> None:
  points = [
      BacktestPoint(
          date=date(2026, 1, 1),
          actual=110,
          p10=100,
          p50=105,
          p90=108,
      ),
      BacktestPoint(
          date=date(2026, 1, 2),
          actual=120,
          p10=110,
          p50=115,
          p90=118,
      ),
  ]

  bias = forecast_bias(points)
  corrected = apply_forecast_bias(
      ModelForecast(p10=[90, 95], p50=[100, 105], p90=[110, 115]),
      bias,
  )

  assert bias == 5
  assert corrected.p10 == [95, 100]
  assert corrected.p50 == [105, 110]
  assert corrected.p90 == [115, 120]
