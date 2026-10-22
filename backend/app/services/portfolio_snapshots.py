import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.errors import AppError
from app.providers.base import MarketDataProvider
from app.services.calendar import TradingCalendar
from app.services.tracking import TrackingStore, TrackingStoreError

logger = logging.getLogger(__name__)
SNAPSHOT_TIMEZONE = ZoneInfo("Asia/Kolkata")
SNAPSHOT_TIME = time(hour=16)
SNAPSHOT_RECHECK_SECONDS = 300
SUPPORTED_EXCHANGES = ("NSE", "BSE")


def _market_is_open(trading_calendar: TradingCalendar, on: date) -> bool:
  return any(
      trading_calendar.is_session(exchange, on)
      for exchange in SUPPORTED_EXCHANGES
  )


def seconds_until_next_snapshot(
    now: datetime,
    trading_calendar: TradingCalendar,
) -> float:
  if now.tzinfo is None:
    raise ValueError("Snapshot scheduling requires a timezone-aware datetime.")
  local_now = now.astimezone(SNAPSHOT_TIMEZONE)
  for day_offset in range(367):
    candidate_date = local_now.date() + timedelta(days=day_offset)
    next_run = datetime.combine(
        candidate_date,
        SNAPSHOT_TIME,
        tzinfo=SNAPSHOT_TIMEZONE,
    )
    if next_run > local_now and _market_is_open(trading_calendar, candidate_date):
      return (next_run - local_now).total_seconds()
  raise RuntimeError("Unable to find an exchange trading day for snapshots.")


def snapshot_window_is_open(
    now: datetime,
    trading_calendar: TradingCalendar,
) -> bool:
  if now.tzinfo is None:
    raise ValueError("Snapshot scheduling requires a timezone-aware datetime.")
  local_now = now.astimezone(SNAPSHOT_TIMEZONE)
  local_time = local_now.time().replace(tzinfo=None)
  return (
      local_time >= SNAPSHOT_TIME
      and _market_is_open(trading_calendar, local_now.date())
  )


class PortfolioSnapshotService:
  def __init__(
      self,
      *,
      provider: MarketDataProvider,
      tracking_store: TrackingStore,
      trading_calendar: TradingCalendar,
      now: Callable[[], datetime] | None = None,
  ) -> None:
    self._provider = provider
    self._tracking_store = tracking_store
    self._trading_calendar = trading_calendar
    self._now = now or (lambda: datetime.now(UTC))

  async def capture_once(self) -> None:
    state = await self._tracking_store.load()
    captured_at = self._now()
    capture_date = captured_at.astimezone(SNAPSHOT_TIMEZONE).date()
    open_exchanges: set[str] = set()
    for exchange in {position.security.exchange for position in state.positions}:
      try:
        if self._trading_calendar.is_session(exchange, capture_date):
          open_exchanges.add(exchange)
      except ValueError:
        logger.warning(
            "Portfolio snapshot skipped unsupported exchange %s.",
            exchange,
        )
    for position in state.positions:
      if position.security.exchange not in open_exchanges:
        continue
      if (
          position.price_history
          and position.price_history[-1].date == capture_date
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
      now = self._now()
      if not snapshot_window_is_open(now, self._trading_calendar):
        await asyncio.sleep(
            seconds_until_next_snapshot(now, self._trading_calendar)
        )
        continue
      try:
        await self.capture_once()
      except TrackingStoreError:
        logger.exception("The scheduled portfolio snapshot could not be saved.")
      await asyncio.sleep(SNAPSHOT_RECHECK_SECONDS)
