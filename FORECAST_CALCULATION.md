# Forecast Calculation

This document describes how TimeSeries Forecast Lab calculates the displayed
forecast. The result is a back-check-corrected TimesFM estimate, not a
guaranteed future price or financial advice.

## 1. Input series

The backend:

1. loads up to five years of daily adjusted closes;
2. sorts and validates the observations without filling weekends, holidays, or
   missing sessions;
3. requires at least 120 valid observations; and
4. sends the ordered values to TimesFM as a one-dimensional `float32` series.

Adjusted close is used so supported split and dividend adjustments are included
in the forecast target.

## 2. Raw TimesFM forecast

TimesFM produces a raw p10, p50, and p90 value for every requested future
session. Let:

- `R(q, h)` be the raw TimesFM quantile `q` at future step `h`;
- `q` be p10, p50, or p90; and
- `h` run from 1 through the requested 5-, 20-, or 60-session horizon.

The p50 value is the median estimate. The p10-p90 range communicates model
uncertainty; it is not a promise that the market price will remain inside the
range.

## 3. Isolated seven-session back-check

When at least 127 observations are available, the latest seven known closes are
removed from a second model run. TimesFM receives only the earlier context and
predicts exactly those seven hidden sessions.

This isolation prevents look-ahead leakage:

- the back-check model context ends before all seven holdout dates;
- the seven actual closes are used only after inference for evaluation and
  correction; and
- the correction is never applied back to the holdout used to measure the
  error.

The API reports mean absolute error, mean absolute percentage error, p10-p90
coverage, daily directional accuracy, and end-direction match from these raw
holdout predictions.

## 4. Latest-holdout level correction

The next forecast uses the residual from the most recent holdout session,
because that is the latest known comparison between the model path and an
actual close.

Let:

- `A` be the actual adjusted close on the seventh holdout session; and
- `M` be the raw TimesFM p50 estimate for that same session.

The signed median error shown to the user is:

```text
signed_error_percent = ((M / A) - 1) * 100
```

A positive value means the raw model estimate was too high. A negative value
means it was too low.

The correction scale is:

```text
scale_factor = A / M
             = 1 / (1 + signed_error_percent / 100)
```

Every future quantile is then corrected with the same positive scale:

```text
corrected(q, h) = R(q, h) * scale_factor
```

Using one multiplicative scale:

- corrects the next-session estimate and the rest of the path consistently;
- preserves `p10 <= p50 <= p90`;
- preserves the relative p10-p90 width; and
- remains proportional when securities have very different price levels.

### Example: raw forecast up 10%, latest error up 12%

Assume the latest known close is `100`, the final holdout p50 was `112` when
the actual close was `100`, and the raw next-session p50 is `110`.

```text
signed_error_percent = ((112 / 100) - 1) * 100 = +12%
scale_factor         = 100 / 112                = 0.892857
corrected next p50   = 110 * 0.892857           = 98.21
```

The raw `+10%` estimate therefore becomes approximately `-1.79%` after the
latest `+12%` overprediction is accounted for. Percentages compound, so the
exact result is not obtained by simply subtracting 12 percentage points.

The calculation uses full floating-point precision. Rounding is for display
only.

## 5. When correction is unavailable

With 120-126 observations, the normal TimesFM forecast remains available, but
there is not enough earlier context for an isolated seven-session holdout. In
that case:

- no back-check correction is applied;
- historical evaluation is unavailable; and
- the evidence level is `limited`.

Index screening applies the same per-security correction when that security has
at least 127 observations.

## 6. Dates and analysis

Corrected quantiles are mapped to future NSE or BSE trading sessions from the
exchange calendar. Weekends and exchange holidays are not forecast dates.

The backend then calculates:

- change from the latest adjusted close to the corrected final p50;
- trend using the corrected median path;
- final corrected p10-p90 width;
- 20- and 50-session historical moving averages;
- alignment with the latest five-session move; and
- an evidence level based on the isolated holdout metrics and trend alignment.

The API exposes the correction method, reference date, signed median error, and
scale factor with the historical evaluation so the adjustment is auditable.

## 7. Limits

This correction responds to one recent seven-session holdout. It does not:

- guarantee accuracy or prevent trading losses;
- prove that the same error will repeat;
- recalibrate the statistical coverage of p10 and p90;
- include news, fundamentals, valuation, liquidity, or personal risk; or
- turn the forecast into a buy, sell, or hold recommendation.

Market regimes can change abruptly. The raw model, back-check, correction, and
uncertainty range should all be treated as research evidence rather than a
promise of future performance.
