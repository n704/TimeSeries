---
description: Backend architecture, model, provider, and API rules
applyTo: "backend/**/*.py"
---

# Backend instructions

- Use Python 3.11-compatible syntax and the existing two-space indentation.
- Keep HTTP concerns in `app/api`, upstream parsing in `app/providers`, and
  inference/analysis behavior in `app/services`.
- Route responses and errors must use the Pydantic models in `app/schemas.py`.
- Raise `AppError` for expected public failures. Do not expose stack traces,
  upstream payloads, credentials, or filesystem paths in API responses.
- Depend on `MarketDataProvider` and `ForecastModel` protocols rather than
  concrete implementations in route logic.
- Never initialize TimesFM per request. Load one adapter during application
  lifespan and keep readiness false until loading succeeds.
- Never download a checkpoint during import, startup, tests, or requests.
- Do not add a success-shaped fallback when TimesFM fails.
- Validate model output shape, positivity, finiteness, and quantile ordering.
- Forecast dates must come from the exchange calendar, not simple date
  arithmetic.
- Ensure resources acquired during lifespan are closed even when startup fails.
- Use fakes in the default test suite. Network and local-checkpoint tests must
  be explicitly opt-in.

Validation:

```bash
cd backend
uv run pytest
```
