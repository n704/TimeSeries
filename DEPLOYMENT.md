# Deployment Guide

This guide distinguishes the supported local macOS runtime from a future
production deployment.

## Current status

The repository is immediately runnable for local development and evaluation.
It is not safe to deploy unchanged as a commercial production service because:

- the checked-in adapter expects a local TimesFM checkpoint;
- TimesFM 3.0 downloaded weights currently restrict commercial/production use;
- Yahoo Finance is a development data adapter whose terms and quotas must be
  reviewed for the intended use;
- production security, capacity, rate limiting, TLS, and operations are not yet
  implemented.

Do not package local TimesFM 3.0 evaluation weights into a production image.

## Local macOS deployment

### 1. Install tools

Required:

- macOS with Apple Silicon for the recommended MLX path;
- `uv`;
- Node.js 22 or later;
- npm.

### 2. Install dependencies

```bash
cd backend
uv sync --extra dev --extra timesfm-mlx

cd ../frontend
npm install
```

Use `timesfm-pytorch` and `TIMESFM_DEVICE=cpu` if MLX is unavailable.

### 3. Download the checkpoint

After accepting the checkpoint license:

```bash
cd backend
uv run hf auth login
uv run hf download google/timesfm-3.0-pytorch \
  --local-dir "$HOME/.cache/timesfm/google-timesfm-3.0-pytorch"
```

### 4. Configure

```bash
cd ..
cp .env.example .env
```

Set `TIMESFM_CHECKPOINT_PATH` to the absolute local directory. Never commit
`.env`, Hugging Face credentials, or model files.

### 5. Validate

```bash
cd backend
uv run pytest

cd ../frontend
npm test
npm run build
```

### 6. Start

Backend:

```bash
cd backend
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend development server:

```bash
cd frontend
npm run dev
```

Use `--reload` only for active development.

### 7. Health checks

```bash
curl --fail http://127.0.0.1:8000/health/live
curl --fail http://127.0.0.1:8000/health/ready
```

The process is not ready until the model is loaded. If the local checkpoint is
missing or invalid, the process remains live for search and history requests,
while readiness and forecast requests return `503`.

## Local release build

Build frontend static assets:

```bash
cd frontend
npm ci
npm run build
```

The result is `frontend/dist/`. It can be served locally by any static server,
but the backend must still run separately.

For a non-Vite web server, configure:

- fallback to `index.html` for application routes if routing is added;
- `/api` requests to the FastAPI service, or set `VITE_API_BASE_URL` before
  building;
- no caching of `index.html` across incompatible releases;
- long-lived caching for content-hashed files under `assets/`.

## Production target architecture

```text
Browser
  |
  | HTTPS
  v
Static frontend host / CDN
  |
  | /api/v1
  v
FastAPI service
  |-- Licensed market-data provider
  |-- Trading calendar
  `-- ForecastModel
        `-- Authorized managed TimesFM or separately licensed backend
```

Redis and response caching are not mandatory. Add them only after measured
traffic and latency justify the operational cost.

## Required production work

### 1. Replace local evaluation inference

Add a `ManagedTimesFMAdapter` or another approved `ForecastModel`
implementation. It must:

- implement `load()` and `predict()`;
- return `ModelForecast` with p10/p50/p90 lists;
- validate timeout, output shape, finiteness, positivity, and quantile order;
- expose backend/model/version metadata;
- avoid changing the `/api/v1` contract.

Do not send source code, credentials, or proprietary data to an unapproved
third party.

### 2. Use licensed market data

Confirm symbol search, adjusted daily history, attribution, retention, and
redistribution rights. Implement a new `MarketDataProvider` if Yahoo Finance is
not permitted for the intended deployment.

### 3. Harden the API

Before internet exposure:

- terminate TLS;
- restrict CORS to exact frontend origins;
- use a non-root runtime user;
- place credentials in a secret manager;
- add per-IP/global rate limiting;
- set provider and model timeouts;
- configure structured logs and redaction;
- add dependency and image vulnerability scanning;
- define memory/CPU limits;
- verify graceful shutdown closes provider clients;
- preserve request IDs through the proxy.

### 4. Size model workers deliberately

The local application loads one model per API process. Do not increase Uvicorn
workers without measuring memory. A managed adapter may allow more API workers,
but its concurrency and quotas still need load testing.

### 5. Configure frontend build

```bash
cd frontend
VITE_API_BASE_URL=https://api.example.com/api/v1 npm ci
VITE_API_BASE_URL=https://api.example.com/api/v1 npm run build
```

Deploy `frontend/dist/` as immutable static assets. `VITE_` variables are public
and embedded at build time.

### 6. Configure backend runtime

Current settings:

| Variable | Purpose |
| --- | --- |
| `APP_ENV` | Current modes are `development` and `test` |
| `ALLOWED_ORIGINS` | Exact allowed frontend origins |
| `MARKET_DATA_PROVIDER` | Provider adapter selection |
| `TIMESFM_BACKEND` | Local `mlx` or `pytorch` adapter |
| `TIMESFM_CHECKPOINT_ID` | User-visible checkpoint identity |
| `TIMESFM_CHECKPOINT_PATH` | Local-only on-disk model path |
| `TIMESFM_DEVICE` | Local device selection |
| `TIMESFM_MODEL_VERSION` | User-visible version |
| `MODEL_LOAD_TIMEOUT_SECONDS` | Model initialization deadline |
| `FORECAST_TIMEOUT_SECONDS` | Forecast deadline |
| `REQUEST_TIMEOUT_SECONDS` | Market provider HTTP deadline |

A managed production adapter will require new settings. Add them to typed
configuration and secret management, and update `.env.example` with safe
placeholders only. Add an explicit `production` value to `APP_ENV` as part of
that work; the current typed configuration intentionally rejects it.

## Release procedure

1. Review model and market-data licenses for the target environment.
2. Run backend tests, frontend tests, and frontend build.
3. Run opt-in integration tests for the selected production adapters.
4. Scan dependencies and deployment artifacts.
5. Deploy the backend to a non-production environment.
6. Verify `/health/live`, `/health/ready`, search, history, and one forecast.
7. Deploy the frontend with the correct API URL.
8. Run desktop and mobile browser smoke tests.
9. Promote the same immutable artifacts to production.
10. Monitor provider errors, forecast latency, model errors, and readiness.

## Rollback

Keep the previous frontend artifact and backend release available.

Rollback order:

1. Roll back the backend if forecast, provider, or readiness behavior fails.
2. Roll back the frontend if only rendering or client/API compatibility fails.
3. Re-run health and forecast smoke checks.
4. Do not reuse a new frontend with an incompatible old API.

The current API is versioned under `/api/v1`; breaking changes require a new
version or a coordinated compatible migration.

## Production readiness checklist

- [ ] Model weights/backend are licensed for the intended environment.
- [ ] Market data is licensed for search, display, and forecasting.
- [ ] A production `ForecastModel` adapter is implemented and tested.
- [ ] Secrets are stored outside files and images.
- [ ] TLS, CORS, rate limits, and secure headers are configured.
- [ ] Resource limits and concurrency are load tested.
- [ ] Logs and metrics redact credentials and avoid unbounded symbol labels.
- [ ] Health checks are connected to the platform.
- [ ] Frontend uses the production API URL.
- [ ] Desktop and mobile end-to-end smoke tests pass.
- [ ] Rollback artifacts and instructions are verified.
