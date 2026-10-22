from collections.abc import Sequence
from math import isfinite
from statistics import fmean

from app.schemas import (
    BacktestMetrics,
    BacktestPoint,
    ForecastCorrection,
    PricePoint,
)
from app.services.forecast import ModelForecast


def _direction(change: float) -> int:
  return 1 if change > 0 else -1 if change < 0 else 0


def build_backtest_points(
    actual_prices: Sequence[PricePoint],
    forecast: ModelForecast,
) -> list[BacktestPoint]:
  return [
      BacktestPoint(
          date=actual.date,
          actual=actual.adjusted_close,
          p10=p10,
          p50=p50,
          p90=p90,
      )
      for actual, p10, p50, p90 in zip(
          actual_prices,
          forecast.p10,
          forecast.p50,
          forecast.p90,
          strict=True,
      )
  ]


def evaluate_backtest(
    points: Sequence[BacktestPoint],
    context_end_price: float,
) -> BacktestMetrics:
  if not points:
    raise ValueError("Back-check points must not be empty.")
  if context_end_price <= 0:
    raise ValueError("Back-check context end price must be positive.")

  absolute_errors = [abs(point.p50 - point.actual) for point in points]
  percentage_errors = [
      absolute_error / point.actual * 100
      for point, absolute_error in zip(points, absolute_errors, strict=True)
  ]
  covered = sum(point.p10 <= point.actual <= point.p90 for point in points)
  direction_matches = 0
  previous_actual = context_end_price
  previous_forecast = context_end_price
  for point in points:
    actual_direction = _direction(point.actual - previous_actual)
    forecast_direction = _direction(point.p50 - previous_forecast)
    direction_matches += actual_direction == forecast_direction
    previous_actual = point.actual
    previous_forecast = point.p50

  return BacktestMetrics(
      mean_absolute_error=round(fmean(absolute_errors), 4),
      mean_absolute_percentage_error=round(fmean(percentage_errors), 2),
      interval_coverage_percent=round(covered / len(points) * 100, 2),
      directional_accuracy_percent=round(
          direction_matches / len(points) * 100,
          2,
      ),
      end_direction_match=(
          _direction(points[-1].actual - context_end_price)
          == _direction(points[-1].p50 - context_end_price)
      ),
  )


def calculate_forecast_correction(
    points: Sequence[BacktestPoint],
) -> ForecastCorrection:
  """Calculate a level correction from the latest known holdout residual."""
  if not points:
    raise ValueError("Back-check points must not be empty.")
  latest = points[-1]
  scale_factor = latest.actual / latest.p50
  signed_error_percent = ((latest.p50 / latest.actual) - 1) * 100
  if not isfinite(scale_factor) or not isfinite(signed_error_percent):
    raise ValueError("Back-check correction must be finite.")
  return ForecastCorrection(
      reference_date=latest.date,
      signed_median_error_percent=signed_error_percent,
      scale_factor=scale_factor,
  )


def apply_forecast_correction(
    forecast: ModelForecast,
    correction: ForecastCorrection,
) -> ModelForecast:
  """Scale all forecast quantiles by the latest holdout correction."""
  corrected = ModelForecast(
      p10=[value * correction.scale_factor for value in forecast.p10],
      p50=[value * correction.scale_factor for value in forecast.p50],
      p90=[value * correction.scale_factor for value in forecast.p90],
  )
  if any(
      not isfinite(value) or value <= 0
      for values in (corrected.p10, corrected.p50, corrected.p90)
      for value in values
  ):
    raise ValueError("Back-check correction produced non-positive forecast values.")
  if any(
      p10 > p50 or p50 > p90
      for p10, p50, p90 in zip(
          corrected.p10,
          corrected.p50,
          corrected.p90,
          strict=True,
      )
  ):
    raise ValueError("Back-check correction produced unordered forecast quantiles.")
  return corrected
