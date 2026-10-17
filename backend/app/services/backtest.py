from statistics import fmean

from app.schemas import BacktestMetrics, BacktestPoint


def evaluate_backtest(points: list[BacktestPoint]) -> BacktestMetrics:
  absolute_errors = [abs(point.p50 - point.actual) for point in points]
  percentage_errors = [
      absolute_error / point.actual * 100
      for point, absolute_error in zip(points, absolute_errors, strict=True)
  ]
  covered = sum(point.p10 <= point.actual <= point.p90 for point in points)
  return BacktestMetrics(
      mean_absolute_error=round(fmean(absolute_errors), 4),
      mean_absolute_percentage_error=round(fmean(percentage_errors), 2),
      interval_coverage_percent=round(covered / len(points) * 100, 2),
  )
