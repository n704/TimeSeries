import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.errors import AppError
from app.providers.base import MarketDataProvider
from app.services.tracking import TrackingStore, TrackingStoreError

logger = logging.getLogger(__name__)
SNAPSHOT_TIMEZONE = ZoneInfo("Asia/Kolkata")
SNAPSHOT_TIME = time(hour=18)
SNAPSHOT_RECHECK_SECONDS = 300


def seconds_until_next_snapshot(now: datetime) -> float:
  if now.tzinfo is None:
    raise ValueError("Snapshot scheduling requires a timezone-aware datetime.")
  local_now = now.astimezone(SNAPSHOT_TIMEZONE)
  next_run = datetime.combine(
      local_now.date(),
      SNAPSHOT_TIME,
      tzinfo=SNAPSHOT_TIMEZONE,
  )
  if local_now >= next_run:
    next_run += timedelta(days=1)
  return (next_run - local_now).total_seconds()


def snapshot_window_is_open(now: datetime) -> bool:
  if now.tzinfo is None:
    raise ValueError("Snapshot scheduling requires a timezone-aware datetime.")
  local_time = now.astimezone(SNAPSHOT_TIMEZONE).time().replace(tzinfo=None)
  return local_time >= SNAPSHOT_TIME


class PortfolioSnapshotService:
  def __init__(
      self,
      *,
      provider: MarketDataProvider,
      tracking_store: TrackingStore,
      now: Callable[[], datetime] | None = None,
  ) -> None:
    self._provider = provider
    self._tracking_store = tracking_store
    self._now = now or (lambda: datetime.now(UTC))

  async def capture_once(self) -> None:
    state = await self._tracking_store.load()
    captured_at = self._now()
    capture_date = captured_at.astimezone(SNAPSHOT_TIMEZONE).date()
    for position in state.positions:
      if (
          position.price_history
          and position.price_history[-1]
          .captured_at.astimezone(SNAPSHOT_TIMEZONE)
          .date()
          == capture_date
      ):
        continue
      symbol = position.security.symbol
      try:
        history = await self._provider.history(symbol, "6mo")
      except AppError as error:
        logger.warning(
            "Portfolio snapshot skipped for %s because the provider returned %s.",
            symbol,
            error.code,
        )
        continue
      if not history.prices:
        logger.warning(
            "Portfolio snapshot skipped for %s because history was empty.",
            symbol,
        )
        continue
      latest = history.prices[-1]
      await self._tracking_store.record_price_snapshot(
          symbol,
          latest.date,
          latest.adjusted_close,
          captured_at,
      )

  async def run(self) -> None:
    while True:
      if not snapshot_window_is_open(self._now()):
        await asyncio.sleep(seconds_until_next_snapshot(self._now()))
        continue
      try:
        await self.capture_once()
      except TrackingStoreError:
        logger.exception("The scheduled portfolio snapshot could not be saved.")
      await asyncio.sleep(SNAPSHOT_RECHECK_SECONDS)
