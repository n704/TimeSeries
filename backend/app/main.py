import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.config import Settings, get_settings
from app.errors import AppError
from app.providers.base import MarketDataProvider
from app.providers.yahoo import YahooMarketDataProvider
from app.schemas import ErrorBody, ErrorResponse
from app.services.calendar import TradingCalendar
from app.services.forecast import ForecastModel, LocalTimesFMAdapter
from app.services.postgres_tracking import PostgresTrackingStore
from app.services.portfolio_snapshots import PortfolioSnapshotService
from app.services.tracking import SQLiteTrackingStore, TrackingStore

logger = logging.getLogger(__name__)


def create_tracking_store(settings: Settings) -> TrackingStore:
  if settings.tracking_database_url is not None:
    return PostgresTrackingStore(
        settings.tracking_database_url.get_secret_value()
    )
  return SQLiteTrackingStore(settings.tracking_database_path)


def _log_snapshot_task_failure(task: asyncio.Task[None]) -> None:
  if task.cancelled():
    return
  error = task.exception()
  if error is not None:
    logger.error(
        "Portfolio snapshot task stopped unexpectedly.",
        exc_info=(type(error), error, error.__traceback__),
    )


def _error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    retryable: bool = False,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
  payload = ErrorResponse(
      error=ErrorBody(
          code=code,
          message=message,
          retryable=retryable,
          request_id=request.state.request_id,
          details=details,
      )
  )
  return JSONResponse(status_code=status_code, content=payload.model_dump(mode="json"))


def create_app(
    *,
    settings: Settings | None = None,
    market_data_provider: MarketDataProvider | None = None,
    forecast_model: ForecastModel | None = None,
    trading_calendar: TradingCalendar | None = None,
    tracking_store: TrackingStore | None = None,
) -> FastAPI:
  configured_settings = settings or get_settings()

  @asynccontextmanager
  async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    provider = market_data_provider or YahooMarketDataProvider(
        configured_settings.request_timeout_seconds
    )
    model = forecast_model or LocalTimesFMAdapter(
        backend=configured_settings.timesfm_backend,
        checkpoint_id=configured_settings.timesfm_checkpoint_id,
        checkpoint_path=configured_settings.timesfm_checkpoint_path,
        device=configured_settings.timesfm_device,
        model_version=configured_settings.timesfm_model_version,
        load_timeout_seconds=configured_settings.model_load_timeout_seconds,
        forecast_timeout_seconds=configured_settings.forecast_timeout_seconds,
    )
    application.state.market_data_provider = provider
    application.state.forecast_model = model
    calendar = trading_calendar or TradingCalendar()
    application.state.trading_calendar = calendar
    application.state.tracking_store = (
        tracking_store or create_tracking_store(configured_settings)
    )
    application.state.model_ready = False
    snapshot_task: asyncio.Task[None] | None = None
    try:
      await application.state.tracking_store.initialize()
      snapshot_service = PortfolioSnapshotService(
          provider=provider,
          tracking_store=application.state.tracking_store,
          trading_calendar=calendar,
      )
      application.state.portfolio_snapshot_service = snapshot_service
      snapshot_task = asyncio.create_task(
          snapshot_service.run(),
          name="portfolio-price-snapshots",
      )
      snapshot_task.add_done_callback(_log_snapshot_task_failure)
      try:
        await model.load()
      except RuntimeError:
        logger.warning(
            "Forecast model is unavailable; readiness remains false. "
            "Check the local TimesFM installation and checkpoint configuration."
        )
      else:
        application.state.model_ready = True
      yield
    finally:
      application.state.model_ready = False
      if snapshot_task is not None and not snapshot_task.done():
        snapshot_task.cancel()
        try:
          await snapshot_task
        except asyncio.CancelledError:
          pass
      await provider.close()

  application = FastAPI(
      title="TimeSeries Stock Forecast API",
      version="0.1.0",
      lifespan=lifespan,
  )
  application.state.settings = configured_settings
  application.state.model_ready = False
  application.add_middleware(
      CORSMiddleware,
      allow_origins=configured_settings.allowed_origins,
      allow_credentials=False,
      allow_methods=["GET", "POST", "PUT"],
      allow_headers=["Content-Type", "X-Request-ID"],
  )

  @application.middleware("http")
  async def add_request_id(request: Request, call_next: Any) -> Any:
    request.state.request_id = request.headers.get("X-Request-ID") or f"req_{uuid4().hex}"
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response

  @application.exception_handler(AppError)
  async def handle_app_error(request: Request, error: AppError) -> JSONResponse:
    return _error_response(
        request,
        status_code=error.status_code,
        code=error.code,
        message=error.message,
        retryable=error.retryable,
        details=error.details,
    )

  @application.exception_handler(RequestValidationError)
  async def handle_validation_error(
      request: Request,
      error: RequestValidationError,
  ) -> JSONResponse:
    return _error_response(
        request,
        status_code=422,
        code="INVALID_REQUEST",
        message="The request contains invalid or unsupported values.",
        details={"fields": jsonable_encoder(error.errors())},
    )

  @application.exception_handler(Exception)
  async def handle_unexpected_error(
      request: Request,
      error: Exception,
  ) -> JSONResponse:
    logger.exception("Unhandled request error", exc_info=error)
    return _error_response(
        request,
        status_code=500,
        code="INTERNAL_ERROR",
        message="An unexpected backend error occurred.",
        retryable=True,
    )

  @application.get("/health/live")
  async def liveness() -> dict[str, str]:
    return {"status": "ok"}

  @application.get("/health/ready", response_model=None)
  async def readiness(request: Request) -> JSONResponse | dict[str, str]:
    if not request.app.state.model_ready:
      return JSONResponse(status_code=503, content={"status": "not_ready"})
    return {"status": "ready"}

  application.include_router(router)
  return application


app = create_app()
