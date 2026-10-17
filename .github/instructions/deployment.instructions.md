---
description: Deployment and runtime configuration safety rules
applyTo: "{DEPLOYMENT.md,.env.example,backend/app/config.py,backend/app/main.py,frontend/vite.config.ts}"
---

# Deployment instructions

- The checked-in TimesFM adapter is for local evaluation with an on-disk
  checkpoint.
- Do not package TimesFM 3.0 downloaded evaluation weights into production
  artifacts under their current license.
- Production inference must be supplied by an authorized or separately licensed
  backend behind `ForecastModel`.
- Keep the frontend `/api/v1` contract stable when changing the inference
  backend.
- Validate configuration at startup and keep readiness false until all required
  internal dependencies are usable.
- Never put secrets in `.env.example`, frontend variables, images, logs, or Git.
- Production work requires explicit CORS, TLS, rate limiting, dependency
  monitoring, market-data licensing, capacity, and rollback decisions.
- Update `DEPLOYMENT.md` whenever ports, environment variables, health checks,
  build commands, or production assumptions change.
