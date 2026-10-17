# AI Agent Guide

This file is the primary operating guide for AI coding agents working in this
repository. Follow it before changing code, dependencies, APIs, or deployment
behavior.

## Read first

Read these files in order:

1. `README.md` - setup, commands, scope, and API summary.
2. `spec.md` - product requirements and public contracts.
3. `backend/README.md` - backend architecture and extension points.
4. `frontend/README.md` - UI state, API usage, and chart behavior.
5. `DEPLOYMENT.md` - local runtime and the production migration boundary.

Scoped instructions also live in:

- `.github/instructions/backend.instructions.md`
- `.github/instructions/frontend.instructions.md`
- `.github/instructions/deployment.instructions.md`

## Product scope

TimeSeries Forecast Lab is a Mac-first research application for daily Indian
common-stock forecasts. The application:

- searches supported NSE and BSE listings by company name or ticker;
- loads adjusted daily close history;
- generates 5-, 20-, or 60-session forecasts;
- back-checks a seven-session holdout against known adjusted closes;
- displays p10, p50, and p90 output from TimesFM;
- visualizes historical prices, moving averages, median predictions, and an
  uncertainty band.

Do not add intraday, options, cryptocurrency, trade execution, portfolio, or
recommendation behavior unless the product specification is intentionally
changed.

## Architecture

```text
React SPA
  |
  | /api/v1 JSON
  v
FastAPI
  |-- MarketDataProvider ----> Yahoo Finance (development adapter)
  |-- TradingCalendar -------> NSE/BSE exchange calendars
  |-- ForecastModel ---------> LocalTimesFMAdapter
  `-- AnalysisService -------> neutral trend metrics and summary
```

Important boundaries:

- `MarketDataProvider` prevents Yahoo-specific response fields from leaking
  into the public API.
- `ForecastModel` prevents MLX/PyTorch types from leaking into routes. A future
  production adapter must implement the same internal contract.
- API routes orchestrate services but do not load checkpoints or parse upstream
  provider payloads.
- The frontend talks only to `/api/v1`; it does not call market-data or model
  providers directly.

## Repository map

```text
backend/app/api/          FastAPI routes
backend/app/providers/    Market-data interface and Yahoo implementation
backend/app/services/     Calendar, analysis, and TimesFM inference
backend/app/schemas.py    Public Pydantic request/response models
backend/tests/            Fakes and backend tests
frontend/src/api/         Typed API client and public error mapping
frontend/src/components/  Chart components and data transforms
frontend/src/App.tsx      Main user journey and request state
frontend/src/styles.css   Responsive visual system
```

## Non-negotiable invariants

1. Use daily adjusted close; do not synthesize weekend or holiday prices.
2. Require at least 120 valid observations before forecasting.
3. Public forecast horizons remain exactly 5, 20, and 60 sessions.
4. Forecast dates must be future exchange sessions.
5. Validate that `p10 <= p50 <= p90`, values are finite and positive, and output
   length equals the requested horizon.
6. Never present a heuristic fallback as TimesFM output.
7. Model checkpoints are never committed to Git.
8. The backend never downloads weights during startup or a request.
9. Readiness stays unavailable until the selected model adapter is usable.
10. Forecast wording remains probabilistic and neutral; never generate buy,
    sell, or hold advice.
11. Abort or ignore stale browser requests when the selected symbol changes.
12. Keep provider secrets and credentials out of the frontend and logs.
13. A back-check must exclude all seven holdout observations from model context.

## Local commands

Backend setup and tests:

```bash
cd backend
uv sync --extra dev --extra timesfm-mlx
uv run pytest
```

Frontend setup, tests, and build:

```bash
cd frontend
npm install
npm test
npm run build
```

Development servers:

```bash
# Terminal 1
cd backend
uv run uvicorn app.main:app --reload --port 8000

# Terminal 2
cd frontend
npm run dev
```

Run the smallest relevant tests first. Run both test suites and the frontend
build before completing cross-stack changes.

## Change guidance

### Changing the API

Update all of the following together:

1. `backend/app/schemas.py`
2. route/service implementation
3. backend API tests
4. `frontend/src/types.ts`
5. `frontend/src/api/client.ts`
6. affected UI and frontend tests
7. `spec.md` and relevant README documentation

Do not change `/api/v1` response shapes without coordinating both applications.

### Adding a market-data provider

Implement `MarketDataProvider`, normalize all fields to internal schemas, add
sanitized fixture tests, and select it through configuration. Do not put
provider-specific branches in API routes.

### Adding a forecast backend

Implement `ForecastModel` and keep backend-specific SDK objects inside the
adapter. Return `ModelForecast` with p10/p50/p90 arrays. Add output validation,
startup readiness behavior, and adapter tests. A managed production adapter must
preserve the public API.

### Changing charts

Keep chart data and metric data aligned to the same API response. Preserve:

- a visible distinction between history and forecast;
- a p10-p90 uncertainty band;
- non-color visual distinctions and labels;
- keyboard-operable controls;
- the table alternative for forecast values;
- mobile layouts without page-level horizontal scrolling.

## Testing strategy

- Backend unit/API tests use deterministic fake providers and model adapters.
- Normal tests must never download a checkpoint or require network access.
- Real market-data and model checks are explicit smoke/integration tests.
- Frontend tests cover behavior and transformations, not only snapshots.
- Browser smoke testing should cover search, security selection, chart loading,
  forecast generation, and a 390 px viewport.

## Deployment boundary

The current application is ready for local development, not unchanged
commercial production deployment.

TimesFM 3.0 downloaded weights currently have non-commercial/non-production
restrictions. Do not package or self-host them in a production image. A
production release must use an authorized managed TimesFM service, a separately
licensed checkpoint, or another legally approved implementation behind
`ForecastModel`.

See `DEPLOYMENT.md` before changing infrastructure or runtime configuration.

## Completion checklist

Before declaring a change complete:

- confirm scope against `spec.md`;
- preserve the invariants above;
- run targeted tests;
- run `uv run pytest` for backend changes;
- run `npm test` and `npm run build` for frontend changes;
- run `git diff --check`;
- update documentation when commands, configuration, APIs, or deployment
  behavior change;
- verify no credentials, local `.env`, checkpoints, build output, or virtual
  environments are staged.
