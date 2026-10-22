# Stock Trend Forecasting Web Application Specification

**Status:** Draft for implementation

**Last updated:** 2026-10-19

**Product type:** Python API and React single-page application

**Initial environment:** Local macOS development

**Forecasting engine:** [Google Research TimesFM](https://github.com/google-research/timesfm)

## 1. Product summary

Build a responsive web application where a user searches for an Indian
common stock listed on NSE or BSE by company name or ticker, reviews its recent
daily market history, and requests a time-series forecast. A Python backend
retrieves and validates market data, runs TimesFM, calculates trend indicators,
and returns a structured analysis to a React frontend. The initial
implementation is a local development prototype that runs TimesFM from a
checkpoint stored on the developer's Mac. The service boundaries must allow a
later licensed production forecast backend without changing the frontend or
public API.

The product must communicate uncertainty clearly. Forecasts are informational
estimates, not guaranteed outcomes or investment advice.

## 2. Goals

1. Accept a company name or ticker and resolve it to an unambiguous listed
   security.
2. Provide a default NIFTY 50 research starting point with a constituent
   dropdown and explicit prediction action.
3. Show historical adjusted closing prices and basic trend context in
   interactive charts.
4. Forecast the next 5, 20, or 60 trading days with TimesFM.
5. Visualize the median forecast and an uncertainty interval alongside history.
6. Summarize the predicted trend in plain language without giving buy, sell, or
   hold recommendations.
7. Provide a fast, accessible, mobile-friendly user experience.
8. Keep market-data and model integrations replaceable so licensing, cost, or
   infrastructure changes do not require frontend changes.
9. Run the complete development application on macOS with TimesFM installed and
   its checkpoint available locally.
10. Let users save a watchlist and paper portfolio in the local application
    database without creating an account or connecting to a brokerage.

## 3. Non-goals for the MVP

- The MVP supports end-of-day common-stock analysis only. Intraday analysis,
  options analysis, and cryptocurrency analysis are explicitly out of scope.
- Executing trades or connecting to brokerage accounts.
- Synced portfolio data, alerts, user accounts, or brokerage integrations.
- Forex or commodity forecasting.
- News, social sentiment, or fundamental analysis.
- Fine-tuning TimesFM on an individual security.
- Implementing production hosting, cloud infrastructure, containers, Redis, or
  application response caching in the initial MVP.
- Claiming that a prediction is financial advice or a guaranteed future price.
- Generating explicit buy, sell, or hold recommendations.

## 4. Users and primary journey

### 4.1 Target user

A retail market observer who wants a simple visual estimate of a stock's
short- or medium-term trend and understands that model output is uncertain.

### 4.2 Primary journey

1. The user opens the application on the **NIFTY 50 research** tab.
2. Reliance is selected by default, its adjusted-close history loads, and the
   20-session forecast starts automatically.
3. The user may choose another NIFTY 50 constituent from a dropdown and select
   **Predict selected stock** to load its history and forecast.
4. The UI shows a neutral screening label derived from the final forecast
   quantiles. It helps choose what to research next and is not a buy, sell, or
   hold recommendation.
5. The user may open **Stock explorer** and type a company name or ticker, such as
   `Reliance` or
   `RELIANCE.NS`.
6. After at least two characters, the UI displays matching securities with
   company name, ticker, exchange, region, and currency.
7. The user selects exactly one result.
8. The application loads the latest historical data and company summary.
9. The user selects a forecast horizon: 5, 20, or 60 trading days.
10. The user selects **Generate forecast**.
11. The UI displays historical prices, the forecast line, an uncertainty band,
   key values, a trend summary, data/model metadata, and a disclaimer.
12. The user can change the horizon or choose a different security.

Submitting free text that has not been resolved to a security must not silently
select a result. An exact ticker match may be selected automatically only when
the provider returns one unique active listing.

## 5. Functional requirements

### 5.1 NIFTY 50 research entry

- `FR-RESEARCH-01`: The NIFTY 50 research tab is selected on initial load.
- `FR-RESEARCH-02`: Reliance Industries is the default constituent and
  automatically requests the default 20-session forecast after history loads.
- `FR-RESEARCH-03`: The dropdown contains all 50 constituent names and symbols.
  Selecting **Predict selected stock** aborts stale history, forecast, and
  back-check requests before loading and forecasting the chosen security.
- `FR-RESEARCH-04`: The research signal describes whether the final p10-p90
  range is above, below, or crosses the latest adjusted close. It must state
  which inputs it omits and that it is not a buy recommendation.
- `FR-RESEARCH-05`: The dropdown uses all 50 constituents from a checked-in NSE
  Indices snapshot. It is not presented as a real-time index-membership feed.
- `FR-RESEARCH-06`: The user can run a fixed 20-session comparison for NIFTY 50,
  NIFTY NEXT 50, NIFTY MIDCAP SELECT, or NIFTY SMALLCAP 100 across all
  constituents with enough valid history.
- `FR-RESEARCH-07`: The comparison returns at most five constituents whose final
  median forecast is above the latest adjusted close, ordered by descending
  percentage change.
- `FR-RESEARCH-08`: The comparison shows analyzed, positive, and unavailable
  counts plus each result's p10-p90 uncertainty. It must be labeled as a neutral
  research screen and must not use buy, sell, or hold recommendation language.

### 5.2 Security search and selection

- `FR-SEARCH-01`: Search accepts company names and ticker symbols,
  case-insensitively.
- `FR-SEARCH-02`: Search is debounced by 300 ms and starts at two characters.
- `FR-SEARCH-03`: Results show name, ticker, exchange, region, currency, and
  instrument type.
- `FR-SEARCH-04`: Only active Indian common-stock listings on NSE or BSE that
  are supported by the configured data provider are forecastable in the MVP.
- `FR-SEARCH-05`: The frontend stores and submits the provider's canonical
  symbol, not the user's raw query.
- `FR-SEARCH-06`: Empty input, no matches, ambiguous matches, unsupported
  instruments, and provider failures each have a distinct UI state.

### 5.3 Historical market data

- `FR-DATA-01`: Use daily adjusted close as the forecast target. Adjustment
  must account for stock splits and dividends where supported by the provider.
- `FR-DATA-02`: Retrieve at least two years and preferably five years of daily
  observations, capped to the model's supported context length.
- `FR-DATA-03`: Sort observations by trading date ascending and deduplicate
  dates.
- `FR-DATA-04`: Reject non-finite, non-positive adjusted prices.
- `FR-DATA-05`: Do not invent observations for weekends, exchange holidays, or
  missing source data.
- `FR-DATA-06`: Require at least 120 valid daily observations. Return a
  structured `INSUFFICIENT_HISTORY` error otherwise. The UI must show the
  available observation count and the minimum required observation count.
- `FR-DATA-07`: Display the provider name, price currency, exchange timezone,
  last market date, and data retrieval time.

### 5.4 Forecast generation

- `FR-FORECAST-01`: Supported horizons are exactly 5, 20, and 60 future trading
  sessions in the MVP.
- `FR-FORECAST-02`: Use an application-level model singleton. Load the TimesFM
  checkpoint once during backend startup, not once per request.
- `FR-FORECAST-03`: Send the ordered adjusted-close series to TimesFM as
  `float32`.
- `FR-FORECAST-04`: Request point forecasts and quantiles. Return the median
  (`p50`) as the primary prediction and `p10`/`p90` as the displayed prediction
  interval after applying the documented back-check correction when available.
- `FR-FORECAST-05`: Map forecast steps to the next valid exchange sessions
  using an exchange calendar. Do not label weekends or exchange holidays as
  forecast dates.
- `FR-FORECAST-06`: Validate output shape and reject non-finite or non-positive
  forecast prices as `MODEL_OUTPUT_INVALID`.
- `FR-FORECAST-07`: Do not extrapolate a 5-day result to produce longer
  horizons.
- `FR-FORECAST-08`: A model or infrastructure error must be surfaced as an
  explicit error. The API must not substitute a heuristic forecast and present
  it as TimesFM output.
- `FR-FORECAST-09`: When at least 127 valid observations are available, each
  forecast also runs an isolated seven-session holdout using context that ends
  before all seven known closes. The latest holdout's `actual / p50` ratio must
  scale every future p10, p50, and p90 value. The raw holdout values must remain
  unchanged for evaluation, and the response must expose the reference date,
  signed median error, and scale factor.

### 5.5 Historical back-check

- `FR-BACKTEST-01`: The user can request a back-check for the latest seven valid
  trading sessions of the selected security.
- `FR-BACKTEST-02`: Remove all seven holdout observations before inference. The
  model context must contain only observations earlier than the first holdout
  date.
- `FR-BACKTEST-03`: Require at least 120 context observations in addition to the
  seven holdout observations.
- `FR-BACKTEST-04`: Predict exactly seven steps with the configured TimesFM
  adapter and pair each output step with the corresponding known market date.
- `FR-BACKTEST-05`: Return actual adjusted close, p10, p50, and p90 for each
  holdout session plus mean absolute error, mean absolute percentage error, and
  p10-p90 interval coverage, daily directional accuracy, and whether the
  modeled end direction matched the actual end direction from the context-end
  close.
- `FR-BACKTEST-06`: Clearly identify the result as one historical holdout. Do
  not present it as a guarantee of future performance or financial advice.

### 5.6 Trend analysis

The backend calculates deterministic explanatory metrics from historical and
forecast values:

- Latest adjusted close.
- Historical percentage change over 5 and 20 trading sessions when available.
- Direction of the latest five-session move using the same +/-1% thresholds as
  the forecast trend, and whether that direction is aligned with, opposed to,
  or neutral relative to the TimesFM median direction.
- 20-session and 50-session simple moving averages.
- Forecast end price and percentage change from the latest close.
- Latest-holdout correction method, reference date, signed median error, and
  scale factor when an isolated holdout is available.
- Trend label:
  - `upward` when forecast change is greater than `+1%`;
  - `downward` when forecast change is less than `-1%`;
  - `mostly_flat` otherwise.
- Interval width at the final forecast step as a percentage of the median.
- An optional isolated seven-session historical evaluation containing mean
  absolute error, mean absolute percentage error, p10-p90 coverage, daily
  directional accuracy, and end-direction match.
- An evidence level:
  - `limited` when the holdout is unavailable, the recent and modeled trends
    are opposed, the holdout end direction does not match, MAPE is greater than
    5%, or daily directional accuracy is below 50%;
  - `supportive` when recent and modeled trends align, MAPE is at most 2%,
    daily directional accuracy is at least 70%, and interval coverage is at
    least 70%;
  - `mixed` otherwise.

The summary must use neutral language, for example:

> TimesFM's median forecast is 3.4% above the latest adjusted close over the
> next 20 trading sessions. The latest five-session move is -2.1% and points in
> the opposite direction. In the isolated seven-session back-check, the median
> path's mean absolute percentage error was 3.2% and daily directional accuracy
> was 42.9%. Taken together, the evidence level is limited; one holdout cannot
> guarantee future accuracy.

The summary must not state that the stock "will" reach a price and must not use
recommendation language.

### 5.7 Model and data disclosure

Every forecast view must show:

- A persistent statement that forecasts are estimates and not financial advice.
- The exact TimesFM model/checkpoint version.
- Forecast generation time.
- Historical data provider and last observed market date.
- Meaning of the p10-p90 interval in plain language.
- A warning when the latest market observation is more than three expected
  trading sessions old.

### 5.8 Chart visualizations

Charts are a required part of the MVP, not an optional enhancement:

- `FR-CHART-01`: Show an interactive historical adjusted-close chart as soon as
  a security's history loads, before the user generates a forecast.
- `FR-CHART-02`: After forecasting, extend the historical chart with the p50
  forecast line and a shaded p10-p90 uncertainty band.
- `FR-CHART-03`: Provide 6-month, 1-year, 2-year, and 5-year historical range
  controls without changing the selected forecast horizon.
- `FR-CHART-04`: Allow users to show or hide 20-session and 50-session moving
  average overlays.
- `FR-CHART-05`: Chart points and summary metrics must come from the same API
  response so their dates and values cannot disagree.
- `FR-CHART-06`: Charts must include accessible labels, keyboard-operable
  controls, tooltips, legends, and a tabular text alternative.
- `FR-CHART-07`: Loading, stale-data, no-data, and error states must be rendered
  in the chart region without displaying misleading placeholder values.

## 6. UX and interface specification

### 6.1 Design principles

- **Focused:** one obvious primary action per state.
- **Transparent:** sources, freshness, model version, and uncertainty are
  visible rather than hidden in tooltips.
- **Calm:** neutral colors and wording; avoid casino-like visuals.
- **Progressive:** show a simple result first and allow details to be expanded.
- **Accessible:** meet WCAG 2.2 AA for the complete primary journey.

### 6.2 Page structure

The MVP is a single-page application with these regions:

1. **Header**
   - Product name.
   - Short subtitle: "Explore time-series forecasts for listed stocks."
2. **Workflow tabs**
   - Default NIFTY 50 research entry with a constituent dropdown and prediction
     button.
   - Stock explorer entry for provider-backed security search.
   - Saved watchlist and paper portfolio entry.
3. **Search panel**
   - Accessible combobox for security search.
   - Recent examples as non-binding suggestions on the empty state.
4. **Security summary**
   - Company name, ticker, exchange, currency, latest adjusted close, and last
     market date.
5. **Forecast controls**
   - Segmented control for 5 days, 20 days, or 60 days.
   - Primary **Generate forecast** button.
6. **Results**
   - Trend summary.
   - Evidence level, latest five-session alignment, and isolated holdout error,
     coverage, and directional accuracy when available.
   - Neutral model-screening label on the NIFTY 50 research tab.
   - Index selector and top-five positive 20-session median comparison with
     coverage and uncertainty.
   - Metric cards: latest close, forecast end, forecast change, interval width.
   - Interactive historical price chart, enhanced with forecast and uncertainty
     visualizations after prediction.
   - Expandable methodology and metadata.
7. **Saved tracking**
   - Add or remove the selected security from a watchlist.
   - Add, update, or remove a paper position with quantity and average price.
   - Show cost basis, snapshot market value, and unrealized change.
   - Let users select a 7-, 20-, or 60-session portfolio outlook. Show the
     selected future session's p50 price and p10-p90 range when that forecast
     point has been generated.
   - Automatically generate missing 20-session forecasts for the 7- and
     20-session portfolio views, and missing 60-session forecasts for the
     60-session view. Show progress and per-symbol failures.
   - Persist tracking state in the backend's local SQLite database.
8. **Footer**
   - Data attribution, model attribution, and financial disclaimer.

### 6.3 Charts

The chart experience has two progressive views:

1. **Historical view:** adjusted close with optional 20-session and 50-session
   moving-average overlays.
2. **Forecast view:** the historical series plus the p50 prediction and p10-p90
   uncertainty band.

- Render the final 120 historical sessions plus all forecast sessions by
  default in the forecast view.
- Historical adjusted close: solid neutral line.
- Median forecast: solid accent line beginning after the final observation.
- p10-p90 interval: translucent area band.
- Add a vertical divider and labels for **Historical** and **Forecast**.
- Tooltip values include date, localized currency value, and series name.
- Users can toggle the uncertainty band.
- Do not rely on color alone; use distinct line styles and labels.
- Include a text/table alternative containing the latest historical point and
  all forecast points.
- On small screens, the chart remains horizontally legible without requiring
  page-level horizontal scrolling.

### 6.4 Required UI states

| State | Expected behavior |
| --- | --- |
| Initial | Search is focused; no empty chart shell is shown. |
| Searching | Inline progress indicator; stale results are not mixed with the new query. |
| No matches | Explain that no supported listed stock was found and suggest checking the name or ticker. |
| Loading security | Show a content skeleton with an accessible status message. |
| Model warming | State that the forecasting model is preparing; do not show fake progress percentages. |
| Forecasting | Keep security context visible, disable duplicate submission, and announce status through `aria-live`. |
| Success | Move focus to the result heading without unexpectedly scrolling the user away from context. |
| Stale data | Show an inline warning but allow forecasting when enough valid data exists. |
| Recoverable error | Preserve the selected security and horizon and provide **Try again**. |
| Unsupported/invalid | Explain what is unsupported; do not offer a retry that cannot succeed. |

### 6.5 Responsive behavior

- Mobile: one-column layout; controls and metric cards stack.
- Tablet: two-column metric grid; chart spans the available width.
- Desktop: content width capped around 1200 px; controls may sit beside the
  security summary.
- Minimum touch target: 44 by 44 CSS pixels.

### 6.6 Formatting and localization

- Display dates in the user's locale while API dates remain ISO 8601.
- Format price values using the security's currency and 2-4 fractional digits
  based on value.
- Format changes with a sign and percentage, such as `+3.4%`.
- Store and transmit timestamps in UTC.

## 7. System architecture

```text
Browser
  |
  | HTTP / JSON on localhost
  v
React + TypeScript SPA
  |
  | /api/v1
  v
FastAPI application
  |-- Security search service ----> Market data provider API
  |-- Historical data service ----> Market data provider API
  |-- Exchange calendar service
  |-- Forecast service -----------> ForecastModel adapter
  |                                  |-- Local TimesFM checkpoint (MVP)
  |                                  `-- Licensed managed backend (future)
  `-- Analysis service
```

### 7.1 Technology choices

#### Backend

- Python 3.11.
- FastAPI with Pydantic v2.
- Uvicorn for local development.
- `httpx` for provider HTTP calls with bounded timeouts.
- `pandas_market_calendars` or an equivalent tested exchange-calendar library.
- TimesFM installed in the backend Python environment.
- MLX TimesFM backend on Apple Silicon Macs where supported; PyTorch CPU is the
  fallback for compatible Macs, with slower inference expected.

#### Frontend

- React with TypeScript and Vite.
- The browser `fetch` API with `AbortController` for typed API requests and
  cancellation.
- React Router only if additional pages are introduced.
- A chart library that supports accessible SVG/canvas rendering, tooltips, and
  area bands. Recharts is acceptable for the MVP.
- CSS variables and component-level styles. A UI kit may be used only if its
  components meet the accessibility requirements.

### 7.2 Repository layout

```text
/
|-- backend/
|   |-- app/
|   |   |-- api/
|   |   |-- core/
|   |   |-- models/
|   |   |-- providers/
|   |   |-- services/
|   |   `-- main.py
|   |-- tests/
|   `-- pyproject.toml
|-- frontend/
|   |-- src/
|   |   |-- api/
|   |   |-- components/
|   |   |-- features/
|   |   |-- pages/
|   |   `-- types/
|   |-- tests/
|   `-- package.json
|-- .env.example
|-- README.md
`-- spec.md
```

### 7.3 Backend boundaries

- `MarketDataProvider`: symbol search, security metadata, and adjusted daily
  history. Provider-specific field names must not leak into API responses.
- `TradingCalendar`: maps an exchange identifier and date to future trading
  sessions.
- `ForecastModel`: accepts validated numeric context and a horizon and returns
  point/quantile arrays. Its interface must not expose MLX, PyTorch, or a future
  managed-service response format.
- `ForecastService`: orchestrates retrieval, preprocessing, inference,
  postprocessing, and metadata.
- `AnalysisService`: calculates deterministic metrics and the neutral summary.

Use dependency injection so provider, calendar, model, and clock can be replaced
by deterministic fakes in tests.

## 8. Market data provider

The implementation must use a provider adapter selected by
`MARKET_DATA_PROVIDER`. The development adapter should use an API that permits
the intended local evaluation and supports both symbol search and adjusted
daily history. Alpha Vantage is acceptable for the MVP, subject to its current
quotas and terms.

The Yahoo Finance development adapter accepts only NSE (`.NS`) and BSE (`.BO`)
equities, preserves the provider's canonical suffixed symbol, and normalizes
prices to INR metadata. Forecast dates use the supported Indian exchange
calendar and must exclude Indian exchange holidays.

Provider requirements:

- Explicit connect/read/total timeouts.
- Retry at most twice, with exponential backoff and jitter, for `429`, `502`,
  `503`, `504`, and transient network failures only.
- Respect `Retry-After`.
- Never retry validation or authentication failures.
- Keep the provider API key only on the server.
- Convert rate-limit failures to the public `DATA_PROVIDER_RATE_LIMITED` error.
- Include a deterministic fixture provider for automated tests and local
  development without network access.

## 9. TimesFM integration

### 9.1 Model selection and licensing

As of this specification:

- TimesFM source code is Apache-2.0 licensed.
- TimesFM 3.0 downloaded weights use a separate non-commercial license and may
  not be self-hosted for commercial or production use.
- Google documents authorized cloud services, including BigQuery ML, for
  commercial and production use.

Therefore:

1. The local, evaluation-only application may use the
   `google/timesfm-3.0-pytorch` checkpoint after the developer accepts and
   complies with its license.
2. Commercial hosting and production model integration are outside this MVP.
   Under the current TimesFM 3.0 weight license, a later production release must
   use an authorized service such as BigQuery ML or another legally permitted
   checkpoint/backend; it must not deploy the local evaluation weights as-is.
3. The local and future production implementations must conform to the same
   `ForecastModel` interface and return the same internal point/quantile shape.
4. The chosen package, checkpoint, source commit or release, backend, and
   preprocessing version must be pinned rather than tracking a moving branch.
5. The developer must review and comply with the checkpoint and market-data
   terms before running the application.

No model checkpoint is committed to this repository.

### 9.2 Local Mac model setup

TimesFM is a local backend dependency for the MVP:

1. Use Python 3.11 in a project virtual environment.
2. On Apple Silicon, install the pinned MLX package extra, for example
   `timesfm[mlx]==3.0.2`. If the selected pinned release or Mac does not support
   MLX, install the pinned PyTorch extra and use CPU inference.
3. Accept the applicable Hugging Face checkpoint license and download the
   complete pinned checkpoint once during explicit developer setup.
4. Store the checkpoint outside Git, such as
   `~/.cache/timesfm/google-timesfm-3.0-pytorch/`, and configure its absolute
   path with `TIMESFM_CHECKPOINT_PATH`.
5. Validate the directory and required model files during backend startup.
   Missing or incomplete files must produce a clear operational log message,
   keep readiness false, and make forecasts return `MODEL_NOT_READY`. Search
   and historical-data endpoints may remain available.
6. Do not download model files automatically while starting the API or serving
   a forecast request. After setup, TimesFM inference must use only local model
   files.

The implementation README must include separate Apple Silicon MLX and PyTorch
CPU setup commands plus a small verification command that loads the local model
and forecasts a synthetic series.

### 9.3 Input and preprocessing

The MVP uses univariate forecasting of adjusted close:

1. Fetch ordered daily observations.
2. Apply the validation rules in section 5.2.
3. Use the latest valid observations up to the pinned model's context limit.
4. Convert values to a one-dimensional `float32` array.
5. Preserve the original price scale. TimesFM performs its own model-specific
   normalization; the application must not duplicate normalization unless
   required by the pinned adapter.
6. Record context start date, context end date, and observation count.

Preprocessing must be versioned. Any future change, such as forecasting log
prices or adding covariates, increments the preprocessing version reported in
the API metadata.

### 9.4 Inference

The local adapter follows the pinned TimesFM API and initializes the evaluator
at process startup. For TimesFM 3.0 this is expected to use
`TimesFM3Evaluator`/`ModelConfig` and `predict_batch`, subject to the exact
pinned release.

Configuration must include:

- `TIMESFM_BACKEND`: `pytorch` or `mlx`.
- `TIMESFM_CHECKPOINT_ID`: pinned checkpoint identifier used during explicit
  setup and displayed in metadata.
- `TIMESFM_CHECKPOINT_PATH`: absolute path to the already-downloaded local
  checkpoint directory.
- `TIMESFM_DEVICE`: `auto` for MLX or `cpu` for the Mac PyTorch fallback.
- `TIMESFM_MODEL_VERSION`: user-visible version string.
- `MODEL_LOAD_TIMEOUT_SECONDS`.
- `FORECAST_TIMEOUT_SECONDS`.

The API readiness check remains false until the model can accept requests.
Model loading failure must terminate the worker or keep readiness false with a
clear operational error; it must not allow requests that can never succeed.

### 9.5 Capacity

Local inference concurrency must be bounded with a semaphore or worker queue to
avoid memory exhaustion. When capacity is full, wait only up to the configured
request timeout and then return `MODEL_BUSY` with a retryable response.

The development server uses one worker so only one model copy is loaded.

### 9.6 Future production compatibility

Production deployment is not part of the initial implementation, but the MVP
must avoid design choices that prevent it:

- Implement local inference in `LocalTimesFMAdapter`, behind the
  `ForecastModel` interface.
- Keep checkpoint paths, MLX/PyTorch objects, and backend-specific quantile
  formats inside that adapter.
- Select the adapter through configuration and dependency injection rather than
  conditionals in API routes.
- A future `ManagedTimesFMAdapter` must be able to use an authorized production
  service while preserving the `/api/v1` request and response contracts.
- Forecast metadata must identify the actual backend, model, and version so a
  production switch is visible to users.
- A production release requires separate infrastructure, load, security,
  reliability, and license review. Redis and application response caching are
  not prerequisites for the local MVP.

## 10. Public API contract

All endpoints are under `/api/v1`. Responses use JSON and UTF-8. Breaking
changes require a new API version.

### 10.1 Search securities

`GET /api/v1/securities/search?q={query}&limit={limit}`

- `q`: 2-64 trimmed characters.
- `limit`: optional, default 8, maximum 20.

Success, `200`:

```json
{
  "results": [
    {
      "symbol": "RELIANCE.NS",
      "name": "Reliance Industries Limited",
      "exchange": "NSE",
      "region": "India",
      "currency": "INR",
      "instrument_type": "common_stock"
    }
  ]
}
```

### 10.2 Get security history

`GET /api/v1/securities/{symbol}/history?range=1y`

Supported display ranges are `6m`, `1y`, `2y`, and `5y`. This endpoint is for
display; the backend independently obtains sufficient context for inference.

Success, `200`:

```json
{
  "security": {
    "symbol": "RELIANCE.NS",
    "name": "Reliance Industries Limited",
    "exchange": "NSE",
    "currency": "INR",
    "timezone": "Asia/Kolkata"
  },
  "prices": [
    {
      "date": "2026-10-16",
      "adjusted_close": 1210.50
    }
  ],
  "metadata": {
    "provider": "configured-provider",
    "retrieved_at": "2026-10-17T12:40:00Z",
    "last_market_date": "2026-10-16",
    "is_stale": false
  }
}
```

### 10.3 Generate a forecast

`POST /api/v1/forecasts`

Request:

```json
{
  "symbol": "RELIANCE.NS",
  "horizon": 20
}
```

Success, `200`:

```json
{
  "forecast_id": "fc_01J...",
  "security": {
    "symbol": "RELIANCE.NS",
    "name": "Reliance Industries Limited",
    "exchange": "NSE",
    "currency": "INR",
    "timezone": "Asia/Kolkata"
  },
  "history": [
    {
      "date": "2026-10-16",
      "adjusted_close": 1210.50
    }
  ],
  "forecast": [
    {
      "date": "2026-10-19",
      "p10": 1180.12,
      "p50": 1216.46,
      "p90": 1255.87
    }
  ],
  "analysis": {
    "latest_close": 1210.50,
    "forecast_end": 1251.66,
    "forecast_change_percent": 3.4,
    "historical_change_5d_percent": 1.2,
    "historical_change_20d_percent": -0.8,
    "recent_trend": "upward",
    "trend_alignment": "aligned",
    "evidence_level": "supportive",
    "historical_evaluation": {
      "holdout_sessions": 7,
      "context_end_date": "2026-10-07",
      "metrics": {
        "mean_absolute_error": 14.25,
        "mean_absolute_percentage_error": 1.18,
        "interval_coverage_percent": 85.71,
        "directional_accuracy_percent": 71.43,
        "end_direction_match": true
      },
      "correction": {
        "method": "latest_holdout_ratio",
        "reference_date": "2026-10-16",
        "signed_median_error_percent": 1.2,
        "scale_factor": 0.988142
      }
    },
    "sma_20": 1195.18,
    "sma_50": 1172.64,
    "trend": "upward",
    "final_interval_width_percent": 12.1,
    "summary": "TimesFM's median forecast is 3.4% above the latest adjusted close over the next 20 trading sessions. The p10-p90 interval widens toward the end of the horizon, indicating increasing uncertainty."
  },
  "metadata": {
    "horizon_trading_days": 20,
    "context_observations": 1257,
    "context_start_date": "2021-10-18",
    "context_end_date": "2026-10-16",
    "provider": "configured-provider",
    "model": "google/timesfm-3.0-pytorch",
    "model_version": "pinned-release",
    "preprocessing_version": "1",
    "generated_at": "2026-10-17T12:41:03Z",
    "is_data_stale": false
  },
  "disclaimer": "This forecast is an uncertain statistical estimate for informational purposes only and is not financial advice. Back-check correction cannot guarantee accuracy or prevent loss."
}
```

`history` in the forecast response contains the latest 120 observations needed
for the default result chart, not necessarily the complete model context.

### 10.4 Back-check the latest seven sessions

`POST /api/v1/backtests`

Request:

```json
{
  "symbol": "RELIANCE.NS"
}
```

Success, `200`:

```json
{
  "backtest_id": "bt_01J...",
  "security": {
    "symbol": "RELIANCE.NS",
    "name": "Reliance Industries Limited",
    "exchange": "NSE",
    "region": "India",
    "currency": "INR"
  },
  "points": [
    {
      "date": "2026-10-08",
      "actual": 1188.4,
      "p10": 1152.1,
      "p50": 1194.8,
      "p90": 1238.6
    }
  ],
  "metrics": {
    "mean_absolute_error": 14.25,
    "mean_absolute_percentage_error": 1.18,
    "interval_coverage_percent": 85.71,
    "directional_accuracy_percent": 71.43,
    "end_direction_match": true
  },
  "metadata": {
    "holdout_sessions": 7,
    "context_observations": 1240,
    "context_start_date": "2021-10-18",
    "context_end_date": "2026-10-07",
    "provider": "Yahoo Finance",
    "backend": "local-mlx",
    "model": "google/timesfm-3.0-pytorch",
    "model_version": "3.0.2",
    "preprocessing_version": "1",
    "generated_at": "2026-10-17T12:41:03Z",
    "is_data_stale": false
  },
  "disclaimer": "This historical back-check measures one seven-session holdout and does not guarantee future forecasting performance or provide financial advice."
}
```

The response always contains exactly seven raw, uncorrected points. The context
end date must precede the first returned point. A normal forecast response uses
the final point's `actual / p50` ratio to correct its future quantiles; the
back-check response itself remains unchanged.

### 10.5 Screen positive index forecasts

`POST /api/v1/research/indexes/screen`

Request:

```json
{
  "index_id": "nifty_next50",
  "horizon": 20
}
```

Supported `index_id` values are `nifty50`, `nifty_next50`,
`nifty_midcap_select`, and `nifty_smallcap100`. The horizon is fixed at 20.
The response contains zero to five results ordered by positive median forecast
change. Metadata includes the selected index name, universe size, analyzed
count, positive count, and symbols unavailable because provider data was
missing, unsupported, or too short. Each result includes latest close, forecast
end, end date, p10, p50, p90, interval width, and data freshness.
Each result also includes its latest-holdout correction or `null` when only
120-126 observations are available.

This endpoint is a neutral research screen. It does not produce a buy, sell, or
hold recommendation.

### 10.6 Saved tracking state

- `GET /api/v1/tracking` returns the saved watchlist, paper positions, forecast
  outlook maps, and database update timestamp.
- `PUT /api/v1/tracking` validates and atomically replaces the complete
  single-user tracking state.

The API permits at most 20 unique watchlist symbols and 20 unique position
symbols. Quantities, prices, and forecast quantiles must be finite and positive;
every outlook must satisfy `p10 <= p50 <= p90`. Supported outlook keys are
exactly `7`, `20`, and `60`.

### 10.7 Health endpoints

- `GET /health/live`: process is running; does not contact external services.
- `GET /health/ready`: model is loaded and required internal dependencies are
  available. It must not repeatedly call the market-data provider.

### 10.8 Error format

All API errors use:

```json
{
  "error": {
    "code": "INSUFFICIENT_HISTORY",
    "message": "RELIANCE.NS does not have enough valid daily history for a forecast.",
    "retryable": false,
    "request_id": "req_01J...",
    "details": {
      "required_observations": 120,
      "available_observations": 74
    }
  }
}
```

Expected codes:

| HTTP | Code | Retryable |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | No |
| 404 | `SECURITY_NOT_FOUND` | No |
| 422 | `UNSUPPORTED_SECURITY` | No |
| 422 | `INSUFFICIENT_HISTORY` | No |
| 429 | `RATE_LIMITED` | Yes |
| 502 | `DATA_PROVIDER_ERROR` | Yes |
| 503 | `DATA_PROVIDER_RATE_LIMITED` | Yes |
| 503 | `MODEL_NOT_READY` | Yes |
| 503 | `MODEL_BUSY` | Yes |
| 503 | `TRACKING_STORAGE_ERROR` | Yes |
| 500 | `MODEL_OUTPUT_INVALID` | Yes |
| 504 | `FORECAST_TIMEOUT` | Yes |

Unexpected exceptions must be logged with the request ID, but stack traces and
secrets must never be returned to the client.

## 11. Development performance and reliability

Targets apply under documented reference hardware and exclude the first model
load:

- Search should usually complete within 1.5 seconds, subject to the external
  provider.
- Historical data should usually load within 2.5 seconds, subject to the
  external provider.
- The UX should tolerate local inference taking up to 15 seconds.
- Frontend initial route: Core Web Vitals in the "good" range at the 75th
  percentile when tested locally on supported mobile profiles.
- Client requests must be cancelable when a new security is selected.
- Each external dependency has a timeout; no request can wait indefinitely.

## 12. Security and privacy

- Bind the development API to localhost by default.
- Restrict CORS to the configured local frontend origin.
- Validate and bound every path, query, and body field.
- Store provider credentials in the backend `.env` file, which must remain
  gitignored, and never expose them in browser bundles.
- Redact provider keys, authorization headers, and full exception payloads from
  logs.
- The MVP stores no user profile. Watchlist and paper portfolio data are stored
  in a single-user local SQLite database and are not synchronized to an account
  or brokerage.
- Do not log credentials or complete upstream response payloads.

## 13. Development diagnostics

Use readable structured logs and propagate a request ID through frontend-visible
errors and backend operations.

Record:

- Request count, duration, and status by route.
- Provider latency, rate-limit count, and error count.
- Forecast latency, queue wait, timeout count, and invalid-output count.
- Model load duration and readiness.
- Model, checkpoint, and preprocessing version on each forecast.

Do not use the stock symbol as an unbounded metrics label. Symbols may appear in
appropriately retained logs.

## 14. Testing strategy

### 14.1 Backend

- Unit tests for input validation, data cleaning, date ordering, minimum history,
  trend thresholds, summary wording, and error mapping.
- Unit tests for trading-session generation across weekends and exchange
  holidays.
- Contract tests for each market-data adapter using recorded, sanitized
  fixtures.
- Model-adapter tests using a lightweight fake; no checkpoint download is
  required for the default unit suite.
- One opt-in integration test against `TIMESFM_CHECKPOINT_PATH` that verifies
  the local model loads and returns the expected shape, finite values, quantile
  ordering, and horizon length. If the checkpoint is absent, the test must skip
  with the required setup command rather than downloading it.
- API tests for success and every documented error family.
- Tests proving concurrent requests do not initialize multiple model instances.

### 14.2 Frontend

- Component tests for the search combobox, horizon control, metrics, chart
  legend, loading state, and error states.
- API client tests that validate response parsing and error mapping.
- Accessibility checks for automated violations plus keyboard-only testing.
- End-to-end tests for search, select, generate, change horizon, retry, and
  narrow mobile viewport.
- Snapshot tests must not replace behavior assertions.

### 14.3 Forecast integrity checks

For every successful response:

- Forecast length equals the requested horizon.
- Dates are unique, ascending valid trading sessions, and begin after history.
- `p10 <= p50 <= p90` at every step.
- All prices and metrics are finite.
- The summary's percentage and direction match the numeric analysis.

## 15. Local development and configuration

### 15.1 Running locally

- Run the FastAPI backend with Uvicorn on `http://localhost:8000`.
- Run the Vite development server on `http://localhost:5173`.
- Configure the Vite development proxy or API base URL to call the backend.
- Install TimesFM and download the pinned checkpoint to the Mac as a separate,
  one-time setup step before starting the backend.
- Run both applications from reproducible dependency lockfiles.
- Redis, Docker, cloud services, and application-level response caching are not
  required.

### 15.2 Required environment variables

```text
APP_ENV
ALLOWED_ORIGINS
MARKET_DATA_PROVIDER
TIMESFM_BACKEND
TIMESFM_CHECKPOINT_ID
TIMESFM_CHECKPOINT_PATH
TIMESFM_DEVICE
TIMESFM_MODEL_VERSION
MODEL_LOAD_TIMEOUT_SECONDS
FORECAST_TIMEOUT_SECONDS
```

Configuration startup validation must fail with a specific message when a
required value is absent or inconsistent with local development mode.

## 16. Implementation phases

### Phase 1: Foundation

- Backend/frontend project scaffolding.
- Typed API client and common error format.
- Fixture market-data and fake-model adapters.
- Search, history, and static result UX.

### Phase 2: Forecasting MVP

- Development market-data adapter.
- Exchange calendar.
- Pinned TimesFM adapter and startup readiness.
- Explicit local checkpoint download and verification workflow for macOS.
- Forecast chart, analysis metrics, disclosure, and all required UI states.
- Development diagnostics and automated tests.

### Future enhancements

- Rolling multi-window backtests with sMAPE and directional accuracy.
- Multiple comparable forecast models, clearly identified.
- TimesFM multivariate/covariate support after documented evaluation.
- Additional licensed exchanges and asset types.
- Shareable forecast URLs that encode only symbol and horizon, never stale
  forecast values.
- Production hosting, deployment security, rate limiting, and licensed managed
  TimesFM inference behind the existing `ForecastModel` interface.
- Application-level caching if later performance measurements justify it.

## 17. MVP acceptance criteria

The MVP is complete only when:

1. A user can search by `Reliance` or `RELIANCE.NS`, select the intended NSE or
   BSE listing, and see current security metadata and historical adjusted-close
   data in INR.
2. The user can generate 5-, 20-, and 60-session forecasts from TimesFM.
3. Each result contains exactly the requested number of valid future trading
   dates and ordered p10/p50/p90 values.
4. The web app displays the historical price chart before forecasting, and the
   forecast view clearly separates history from prediction and displays an
   uncertainty band.
5. The numeric metrics and neutral-language summary are internally consistent.
6. Loading, empty, stale, unsupported, rate-limited, model-busy, timeout, and
   general failure states are understandable and recoverable where applicable.
7. The complete primary journey works with keyboard-only navigation and has no
   critical automated WCAG 2.2 AA violations.
8. No provider secret or model credential is present in client assets, API
   responses, logs, or source control.
9. Unit, API, frontend, and end-to-end test suites pass locally.
10. The developer has accepted and followed TimesFM and market-data terms for
    local evaluation.
11. TimesFM is installed in the local Python environment, the configured
    checkpoint is present on disk, and the opt-in local model verification test
    passes without downloading model files at runtime.
12. The readiness endpoint remains unavailable until the configured forecast
    backend can serve requests.
13. Every result visibly identifies its data source, last market date, model
    version, generation time, and financial disclaimer.
14. A user can back-check the latest seven sessions, inspect actual versus
    predicted prices, inspect error and directional metrics, and confirm that
    the model context ends before the holdout.
15. Every forecast with enough history identifies when its corrected TimesFM
    direction opposes the latest five-session move and applies the disclosed
    latest-holdout ratio to all future model quantiles without altering the raw
    holdout evidence.

## 18. References

- [TimesFM repository](https://github.com/google-research/timesfm)
- [TimesFM paper](https://arxiv.org/abs/2310.10688)
- [TimesFM checkpoints](https://huggingface.co/collections/google/timesfm-release-66e4be5fdb56e960c1e482a6)
- [TimesFM 3.0 checkpoint and weight license](https://huggingface.co/google/timesfm-3.0-pytorch)
