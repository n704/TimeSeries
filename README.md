# TimeSeries Forecast Lab

A Mac-first stock trend forecasting application with:

- a Python 3.11 and FastAPI backend;
- a React and TypeScript frontend;
- a default NIFTY 50 research workflow with a constituent dropdown and prediction action;
- daily Indian common-stock data from Yahoo Finance;
- an on-disk Google Research TimesFM 3.0 checkpoint;
- historical and forecast charts with p10-p90 uncertainty ranges.

The application forecasts 5, 20, or 60 future trading sessions. It does not
support intraday data, options, cryptocurrency, trade execution, or financial
recommendations.

> Forecasts are uncertain statistical estimates for local research only and are
> not financial advice.

## Repository structure

```text
backend/       FastAPI API, market-data adapter, TimesFM adapter, and tests
frontend/      Vite React application, chart components, and tests
AGENTS.md      Repository guide for AI coding agents
DEPLOYMENT.md  Local runtime and future production deployment guide
spec.md        Product and technical specification
```

## Documentation

- [AI agent guide](./AGENTS.md)
- [Backend guide](./backend/README.md)
- [Frontend guide](./frontend/README.md)
- [Deployment guide](./DEPLOYMENT.md)
- [Product and technical specification](./spec.md)

## Prerequisites

- macOS on Apple Silicon for the recommended MLX backend.
- [uv](https://docs.astral.sh/uv/) for Python and virtual environments.
- Node.js 22 or later and npm.
- Sufficient disk and memory for the TimesFM 3.0 checkpoint.
- A Hugging Face account that has accepted the
  [TimesFM 3.0 checkpoint license](https://huggingface.co/google/timesfm-3.0-pytorch).

TimesFM 3.0 downloaded weights are licensed for non-commercial,
non-production use. See [Production path](#production-path) before deploying
this application.

## 1. Install the backend

From the repository root:

```bash
cd backend
uv sync --extra dev --extra timesfm-mlx
```

`uv` installs the project's pinned Python 3.11 toolchain automatically. On a Mac
where MLX is unavailable, install the slower PyTorch CPU backend instead:

```bash
cd backend
uv sync --extra dev --extra timesfm-pytorch
```

## 2. Download TimesFM locally

Model download is an explicit one-time setup step. The API never downloads
weights during startup or a forecast request.

After accepting the checkpoint license:

```bash
cd backend
uv run hf auth login
uv run hf download google/timesfm-3.0-pytorch \
  --local-dir "$HOME/.cache/timesfm/google-timesfm-3.0-pytorch"
```

Model files must stay outside Git. Do not place credentials or checkpoints in
the repository.

## 3. Configure the application

Create the local environment file:

```bash
cp .env.example .env
```

Edit `TIMESFM_CHECKPOINT_PATH` in `.env` so it contains the absolute path to the
downloaded directory.

For Apple Silicon:

```text
TIMESFM_BACKEND=mlx
TIMESFM_DEVICE=auto
```

For the PyTorch fallback:

```text
TIMESFM_BACKEND=pytorch
TIMESFM_DEVICE=cpu
```

The backend validates the directory and loads TimesFM before reporting itself
ready. With a missing or incomplete checkpoint, the API remains live for stock
search and history, but readiness returns `503` and forecast requests return
`MODEL_NOT_READY`. The backend never substitutes another prediction method.

## 4. Verify the backend

Run the automated backend tests; these use a deterministic model fake and do
not download TimesFM:

```bash
cd backend
uv run pytest
```

Then verify the installed package and local checkpoint:

```bash
cd backend
uv run python -c "
from pathlib import Path
from app.config import get_settings
s = get_settings()
p = Path(s.timesfm_checkpoint_path).expanduser()
assert p.is_dir() and any(p.iterdir()), f'Missing checkpoint: {p}'
__import__('timesfm3')
print(f'TimesFM {s.timesfm_model_version} is installed; checkpoint found at {p}')
"
```

## 5. Install and verify the frontend

```bash
cd frontend
npm install
npm test
npm run build
```

## 6. Run the application

Start both local services from the repository root:

```bash
uv run --project backend python scripts/start_services.py
```

The supervisor validates `uv`, `npm`, and the configured TimesFM checkpoint,
starts both processes, and stops the other service if either process exits.
Validate prerequisites without starting anything:

```bash
uv run --project backend python scripts/start_services.py --check
```

Alternatively, use two terminals.

Backend:

```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite server proxies
`/api` and `/health` requests to the backend on port 8000.

Useful health checks:

```bash
curl http://localhost:8000/health/live
curl http://localhost:8000/health/ready
```

The readiness endpoint returns `503` until TimesFM has loaded.

### Docker Compose development stack

Set `TIMESFM_CHECKPOINT_HOST_PATH` in `.env` to the same absolute checkpoint
directory used by `TIMESFM_CHECKPOINT_PATH`, then run:

```bash
docker compose up --build
```

Open [http://localhost:5173](http://localhost:5173). Stop the stack with:

```bash
docker compose down
```

Compose bind-mounts the checkpoint read-only at `/models/timesfm`; it never
copies model weights into an image. The Linux backend uses PyTorch CPU because
MLX is macOS-only. This stack is for local evaluation, not production.

## API summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/securities/search?q=Reliance` | Search supported Indian stocks |
| `GET` | `/api/v1/securities/RELIANCE.NS/history?range=1y` | Load adjusted-close history |
| `POST` | `/api/v1/forecasts` | Generate a 5-, 20-, or 60-session forecast |
| `POST` | `/api/v1/backtests` | Back-check predictions for the latest 7 sessions |
| `POST` | `/api/v1/research/indexes/screen` | Rank up to 5 positive 20-session forecasts in a supported index |
| `GET` | `/health/live` | Check the API process |
| `GET` | `/health/ready` | Check whether TimesFM is loaded |

Example forecast request:

```bash
curl -X POST http://localhost:8000/api/v1/forecasts \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"RELIANCE.NS","horizon":20}'
```

Example historical back-check:

```bash
curl -X POST http://localhost:8000/api/v1/backtests \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"RELIANCE.NS"}'
```

The back-check hides the latest seven adjusted closes, predicts them using only
earlier observations, and reports median-error and p10-p90 coverage metrics.
It is a single historical holdout, not a guarantee of future accuracy.

Example index research screen:

```bash
curl -X POST http://localhost:8000/api/v1/research/indexes/screen \
  -H 'Content-Type: application/json' \
  -d '{"index_id":"nifty_next50","horizon":20}'
```

The screen supports NIFTY 50, NIFTY NEXT 50, NIFTY MIDCAP SELECT, and NIFTY
SMALLCAP 100. It compares available constituents in one TimesFM batch and
returns up to five positive 20-session median percentage changes with p10-p90
uncertainty. It is a research ranking, not a buy, sell, or hold recommendation.

## Market-data scope

The initial Yahoo Finance adapter accepts active Indian common stocks listed on
NSE or BSE. Yahoo's canonical symbols include the exchange suffix, such as
`RELIANCE.NS` or `RELIANCE.BO`. The adapter uses daily adjusted close in INR and
does not fill weekends or Indian exchange holidays.

Yahoo Finance is an external service. Review its current terms before use. A
future licensed provider can replace the adapter without changing the frontend
API.

## Production path

The initial version is intentionally local and does not require Redis, response
caching, Docker, or cloud infrastructure. The backend isolates forecasting
behind the `ForecastModel` interface:

- local development uses `LocalTimesFMAdapter` with MLX or PyTorch;
- a later production release can add `ManagedTimesFMAdapter` while retaining
  the same `/api/v1` contract.

Do not self-host the TimesFM 3.0 evaluation weights in production under their
current license. Use an authorized commercial service such as BigQuery ML, a
separately licensed checkpoint, or another legally reviewed forecast backend.
Production deployment also requires a separate security, reliability, market
data licensing, and capacity review.
