# Backend

FastAPI service for security search, adjusted-close history, exchange-aware
forecast dates, local TimesFM inference, holdout-aware neutral trend analysis,
and SQLite watchlist/portfolio persistence.

## Architecture

```text
app/main.py
  |-- application lifespan and readiness
  |-- request IDs, CORS, and exception mapping
  `-- API router

app/api/routes.py
  |-- MarketDataProvider
  |-- TradingCalendar
  |-- ForecastModel
  |-- TrackingStore
  `-- AnalysisService
```

### Main modules

| Module | Responsibility |
| --- | --- |
| `app/config.py` | Environment-backed settings |
| `app/schemas.py` | Public request, response, and error models |
| `app/errors.py` | Expected application error type |
| `app/providers/base.py` | Market-data protocol and normalized history |
| `app/providers/yahoo.py` | Yahoo search/history adapter |
| `app/services/calendar.py` | Future NSE and BSE trading sessions |
| `app/services/forecast.py` | Forecast protocol and local TimesFM adapter |
| `app/services/analysis.py` | Trend metrics and neutral summary |
| `app/services/tracking.py` | SQLite watchlist and paper portfolio persistence |
| `app/api/routes.py` | `/api/v1` endpoints and orchestration |

## Setup

Recommended Apple Silicon setup:

```bash
uv sync --extra dev --extra timesfm-mlx
```

PyTorch CPU fallback:

```bash
uv sync --extra dev --extra timesfm-pytorch
```

Copy the root environment template:

```bash
cp ../.env.example ../.env
```

The settings loader checks `backend/.env` and the repository-root `.env`.

## TimesFM checkpoint

Accept the applicable Hugging Face license, then explicitly download the model:

```bash
uv run hf auth login
uv run hf download google/timesfm-3.0-pytorch \
  --local-dir "$HOME/.cache/timesfm/google-timesfm-3.0-pytorch"
```

Set `TIMESFM_CHECKPOINT_PATH` to the absolute downloaded directory. If the path
is absent or empty, the API remains available for search and history while
readiness and forecasting remain unavailable. The API does not download model
files.

## Run

```bash
uv run uvicorn app.main:app --reload --port 8000
```

API documentation is available at:

- `http://localhost:8000/docs`
- `http://localhost:8000/openapi.json`

Health endpoints:

- `/health/live` reports that the process is alive.
- `/health/ready` reports readiness only after the model adapter loads.

A missing model checkpoint does not prevent search and history requests. In
that state, `/health/ready` returns `503` and forecast requests return the
structured `MODEL_NOT_READY` error.

Tracking data is stored in `data/tracking.sqlite3` by default. Override the path
with `TRACKING_DATABASE_PATH`. The database and its WAL files are local runtime
data and must not be committed.

## API

### Search

```http
GET /api/v1/securities/search?q=Reliance&limit=8
```

### History

```http
GET /api/v1/securities/RELIANCE.NS/history?range=1y
```

Supported ranges: `6m`, `1y`, `2y`, and `5y`.

### Forecast

```http
POST /api/v1/forecasts
Content-Type: application/json

{"symbol":"RELIANCE.NS","horizon":20}
```

### Watchlist and paper portfolio

```http
GET /api/v1/tracking
```

```http
PUT /api/v1/tracking
Content-Type: application/json

{"watchlist":[],"positions":[]}
```

The update replaces the complete single-user tracking state atomically after
schema, size, symbol uniqueness, and forecast-quantile validation.

Supported horizons: `5`, `20`, and `60`.

### Seven-session back-check

```http
POST /api/v1/backtests
Content-Type: application/json

{"symbol":"RELIANCE.NS"}
```

The endpoint withholds the latest seven valid adjusted-close observations,
predicts those seven sessions using only the earlier context, and returns the
actual and p10/p50/p90 values. It also reports mean absolute error, mean
absolute percentage error, p10-p90 interval coverage, daily directional
accuracy, and whether the modeled end direction matched the holdout.

### Index positive forecast screen

```http
POST /api/v1/research/indexes/screen
Content-Type: application/json

{"index_id":"nifty_smallcap100","horizon":20}
```

The endpoint loads five years of daily adjusted closes for the selected
checked-in index snapshot, runs one TimesFM batch, and returns up to five
constituents with the highest positive 20-session median percentage changes.
Supported universes are NIFTY 50, NIFTY NEXT 50, NIFTY MIDCAP SELECT, and NIFTY
SMALLCAP 100. The response reports the analyzed and unavailable symbols plus
final p10-p90 uncertainty. It is not an investment recommendation.

## Data and model flow

1. Fetch up to five years of adjusted daily close data.
2. Validate, order, and require at least 120 observations.
3. Convert the context to `float32`.
4. Run the configured singleton `ForecastModel`.
5. When at least 127 observations are available, run a second isolated
   seven-session holdout forecast using context that ends before all seven
   known closes.
6. Calculate the mean signed holdout error (`actual - p50`) and shift the
   future p10, p50, and p90 forecasts by that bias. This correction uses only
   the immediately preceding holdout and is not applied to the back-check
   itself.
7. Extract and validate p10, p50, and p90 without modifying the raw TimesFM
   output used for back-check metrics.
8. Map output steps to future Indian exchange sessions.
9. Calculate moving averages, changes, trend, uncertainty width, recent
   five-session alignment, and holdout error/directional evidence.
10. Return the most recent 120 historical points for the default forecast chart.

For a back-check, the latest seven observations are removed before inference
and are used only after inference to calculate holdout metrics and the
leakage-safe bias correction. A forecast with 120-126 observations remains
available without correction, but its evidence level is limited because an
isolated holdout cannot be formed.

## Tests

```bash
uv run pytest
```

The default tests use `FakeMarketDataProvider`, `FakeForecastModel`, and
`FakeTradingCalendar`. They do not use the network or download a checkpoint.

Tests cover:

- analysis calculations and wording;
- endpoint success and error contracts;
- insufficient history;
- seven-session holdout isolation, error, coverage, and directional metrics;
- recent-trend disagreement and forecast evidence levels;
- multi-index batch screening and positive 20-session ranking;
- application startup cleanup;
- local adapter checkpoint requirements;
- decile-to-p10/p50/p90 mapping.

## Extension points

### New market-data provider

Implement `MarketDataProvider`, normalize the response to `Security`,
`PricePoint`, and `HistoryMetadata`, and inject it into `create_app`. Do not add
provider-specific fields to the public API.

### Production forecast backend

Implement `ForecastModel` and return `ModelForecast`. Keep SDK-specific types
inside the adapter. Production licensing and infrastructure are described in
the root `DEPLOYMENT.md`.

## Common pitfalls

- A local checkpoint path is not a Hugging Face model ID.
- A normal unit test must not instantiate or download TimesFM.
- More Uvicorn workers mean more model copies and substantially more memory.
- Calendar dates must come from `TradingCalendar`; weekends-only logic is not
  sufficient.
- Provider clients must close on shutdown even when model loading fails.
