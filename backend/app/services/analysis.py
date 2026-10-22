from collections.abc import Sequence

from app.schemas import Analysis, ForecastPoint, HistoricalEvaluation, PricePoint

SUPPORTIVE_MAPE_PERCENT = 2
LIMITED_MAPE_PERCENT = 5
SUPPORTIVE_DIRECTIONAL_ACCURACY_PERCENT = 70
LIMITED_DIRECTIONAL_ACCURACY_PERCENT = 50
SUPPORTIVE_COVERAGE_PERCENT = 70


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


def _trend(change: float | None) -> str:
  if change is None:
    return "mostly_flat"
  return "upward" if change > 1 else "downward" if change < -1 else "mostly_flat"


def _trend_alignment(forecast_trend: str, recent_trend: str) -> str:
  if "mostly_flat" in {forecast_trend, recent_trend}:
    return "neutral"
  return "aligned" if forecast_trend == recent_trend else "opposed"


def _evidence_level(
    evaluation: HistoricalEvaluation | None,
    alignment: str,
) -> str:
  if evaluation is None:
    return "limited"

  metrics = evaluation.metrics
  if (
      alignment == "opposed"
      or not metrics.end_direction_match
      or metrics.mean_absolute_percentage_error > LIMITED_MAPE_PERCENT
      or metrics.directional_accuracy_percent < LIMITED_DIRECTIONAL_ACCURACY_PERCENT
  ):
    return "limited"
  if (
      alignment == "aligned"
      and metrics.mean_absolute_percentage_error <= SUPPORTIVE_MAPE_PERCENT
      and metrics.directional_accuracy_percent
      >= SUPPORTIVE_DIRECTIONAL_ACCURACY_PERCENT
      and metrics.interval_coverage_percent >= SUPPORTIVE_COVERAGE_PERCENT
  ):
    return "supportive"
  return "mixed"


def analyze_forecast(
    history: Sequence[PricePoint],
    forecast: Sequence[ForecastPoint],
    historical_evaluation: HistoricalEvaluation | None = None,
) -> Analysis:
  if not history or not forecast:
    raise ValueError("History and forecast must not be empty.")

  latest_close = history[-1].adjusted_close
  forecast_end = forecast[-1].p50
  change = _rounded(_percent_change(latest_close, forecast_end))
  trend = _trend(change)
  recent_change = _historical_change(history, 5)
  recent_trend = _trend(recent_change)
  trend_alignment = _trend_alignment(trend, recent_trend)
  evidence_level = _evidence_level(historical_evaluation, trend_alignment)
  interval_width = _rounded(
      ((forecast[-1].p90 - forecast[-1].p10) / forecast[-1].p50) * 100
  )
  direction_text = {
      "upward": "above",
      "downward": "below",
      "mostly_flat": "near",
  }[trend]
  correction = (
      historical_evaluation.correction
      if historical_evaluation is not None
      else None
  )
  forecast_subject = (
      "The back-check-corrected TimesFM median forecast"
      if correction is not None
      else "TimesFM's median forecast"
  )
  summary_parts = [
      f"{forecast_subject} is {abs(change):.1f}% {direction_text} the latest "
      f"adjusted close over the next {len(forecast)} trading sessions. The p10-p90 "
      "range shows uncertainty, which may widen further into the forecast."
  ]
  if recent_change is not None:
    alignment_text = {
        "aligned": "points in the same direction",
        "opposed": "points in the opposite direction",
        "neutral": "does not establish the same directional signal",
    }[trend_alignment]
    summary_parts.append(
        f"The latest five-session move is {recent_change:+.1f}% and "
        f"{alignment_text}."
    )
  if historical_evaluation is None:
    summary_parts.append(
        "A seven-session holdout assessment is unavailable because there is not "
        "enough earlier history."
    )
  else:
    metrics = historical_evaluation.metrics
    direction_result = (
        "matched" if metrics.end_direction_match else "did not match"
    )
    if correction is not None:
      error_direction = (
          "above"
          if correction.signed_median_error_percent > 0
          else "below"
          if correction.signed_median_error_percent < 0
          else "at"
      )
      adjustment_percent = (correction.scale_factor - 1) * 100
      summary_parts.append(
          "The latest holdout median was "
          f"{abs(correction.signed_median_error_percent):.1f}% "
          f"{error_direction} its known close on {correction.reference_date}; "
          f"a {correction.scale_factor:.4f} scale "
          f"({adjustment_percent:+.1f}%) was applied to every future quantile."
      )
    summary_parts.append(
        f"In the isolated {historical_evaluation.holdout_sessions}-session "
        "back-check, the median path's mean absolute percentage error was "
        f"{metrics.mean_absolute_percentage_error:.1f}%, daily directional "
        f"accuracy was {metrics.directional_accuracy_percent:.1f}%, and its "
        f"end direction {direction_result} the known holdout."
    )
  summary_parts.append(
      f"Taken together, the evidence level for this outlook is {evidence_level}; "
      "one holdout cannot guarantee future accuracy."
  )
  return Analysis(
      latest_close=_rounded(latest_close),
      forecast_end=_rounded(forecast_end),
      forecast_change_percent=change,
      historical_change_5d_percent=recent_change,
      historical_change_20d_percent=_historical_change(history, 20),
      recent_trend=recent_trend,
      trend_alignment=trend_alignment,
      evidence_level=evidence_level,
      historical_evaluation=historical_evaluation,
      sma_20=_moving_average(history, 20),
      sma_50=_moving_average(history, 50),
      trend=trend,
      final_interval_width_percent=interval_width,
      summary=" ".join(summary_parts),
  )
