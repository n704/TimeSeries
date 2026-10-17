# Backend

FastAPI service for security search, adjusted-close history, exchange-aware
forecast dates, local TimesFM inference, and neutral trend analysis.

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
| `app/services/calendar.py` | Future XNYS trading sessions |
| `app/services/forecast.py` | Forecast protocol and local TimesFM adapter |
| `app/services/analysis.py` | Trend metrics and neutral summary |
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

Set `TIMESFM_CHECKPOINT_PATH` to the absolute downloaded directory. Startup
fails if the path is absent or empty. The API does not download model files.

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

## API

### Search

```http
GET /api/v1/securities/search?q=Apple&limit=8
```

### History

```http
GET /api/v1/securities/AAPL/history?range=1y
```

Supported ranges: `6m`, `1y`, `2y`, and `5y`.

### Forecast

```http
POST /api/v1/forecasts
Content-Type: application/json

{"symbol":"AAPL","horizon":20}
```

Supported horizons: `5`, `20`, and `60`.

## Data and model flow

1. Fetch up to five years of adjusted daily close data.
2. Validate, order, and require at least 120 observations.
3. Convert the context to `float32`.
4. Run the configured singleton `ForecastModel`.
5. Extract and validate p10, p50, and p90.
6. Map output steps to future XNYS sessions.
7. Calculate moving averages, changes, trend, and uncertainty width.
8. Return the most recent 120 historical points for the default forecast chart.

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
- Provider clients must close even when model loading fails.
