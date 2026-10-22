import asyncio
from datetime import UTC, date, datetime

import pytest

from app.schemas import PortfolioPosition, Security, TrackingState
from app.services.portfolio_snapshots import (
    PortfolioSnapshotService,
    seconds_until_next_snapshot,
    snapshot_window_is_open,
)
from app.services.calendar import TradingCalendar
from app.services.tracking import SQLiteTrackingStore
from tests.fakes import FakeMarketDataProvider


def test_snapshot_schedule_targets_four_pm_on_exchange_trading_days() -> None:
  calendar = TradingCalendar()
  before = datetime(2026, 10, 22, 10, 29, tzinfo=UTC)
  after = datetime(2026, 10, 22, 10, 31, tzinfo=UTC)

  assert seconds_until_next_snapshot(before, calendar) == 60
  assert seconds_until_next_snapshot(after, calendar) == 86_340
  assert snapshot_window_is_open(before, calendar) is False
  assert snapshot_window_is_open(after, calendar) is True


def test_snapshot_schedule_rejects_naive_time() -> None:
  calendar = TradingCalendar()

  with pytest.raises(ValueError, match="timezone-aware"):
    seconds_until_next_snapshot(datetime(2026, 10, 22, 16), calendar)

  with pytest.raises(ValueError, match="timezone-aware"):
    snapshot_window_is_open(datetime(2026, 10, 22, 16), calendar)


def test_snapshot_schedule_skips_exchange_holidays() -> None:
  calendar = TradingCalendar()
  after_monday_capture = datetime(2026, 10, 19, 10, 31, tzinfo=UTC)
  diwali_afternoon = datetime(2026, 10, 20, 10, 31, tzinfo=UTC)

  assert seconds_until_next_snapshot(after_monday_capture, calendar) == 172_740
  assert snapshot_window_is_open(diwali_afternoon, calendar) is False


def test_snapshot_service_records_latest_market_close(tmp_path) -> None:
  provider = FakeMarketDataProvider(count=149)
  store = SQLiteTrackingStore(tmp_path / "tracking.sqlite3")
  calendar = TradingCalendar()
  security = Security(
      symbol="RELIANCE.NS",
      name="Reliance Industries Limited",
      exchange="NSE",
      currency="INR",
  )
  state = TrackingState(
      positions=[
          PortfolioPosition(
              security=security,
              quantity=2,
              average_price=100,
              latest_close=247,
              last_market_date=date(2026, 5, 28),
              updated_at=datetime(2026, 5, 28, 10, 30, tzinfo=UTC),
          )
      ]
  )
  captured_at = datetime(2026, 5, 29, 10, 30, tzinfo=UTC)
  service = PortfolioSnapshotService(
      provider=provider,
      tracking_store=store,
      trading_calendar=calendar,
      now=lambda: captured_at,
  )

  asyncio.run(store.initialize())
  asyncio.run(store.save(state))
  asyncio.run(
      store.record_price_snapshot(
          "RELIANCE.NS",
          date(2026, 5, 28),
          247,
          datetime(2026, 5, 28, 10, 30, tzinfo=UTC),
      )
  )
  asyncio.run(service.capture_once())
  asyncio.run(service.capture_once())
  loaded = asyncio.run(store.load())

  assert provider.history_calls == 1
  assert loaded.positions[0].latest_close == 248
  assert loaded.positions[0].last_market_date == date(2026, 5, 29)
  assert [snapshot.adjusted_close for snapshot in loaded.positions[0].price_history] == [
      247,
      248,
  ]
  assert loaded.positions[0].price_history[-1].captured_at == captured_at


def test_snapshot_service_skips_positions_when_exchange_is_closed(tmp_path) -> None:
  provider = FakeMarketDataProvider()
  store = SQLiteTrackingStore(tmp_path / "tracking.sqlite3")
  security = Security(
      symbol="RELIANCE.NS",
      name="Reliance Industries Limited",
      exchange="NSE",
      currency="INR",
  )
  state = TrackingState(
      positions=[
          PortfolioPosition(
              security=security,
              quantity=2,
              average_price=100,
              latest_close=248,
              last_market_date=date(2026, 10, 19),
              updated_at=datetime(2026, 10, 19, 10, 30, tzinfo=UTC),
          )
      ]
  )
  service = PortfolioSnapshotService(
      provider=provider,
      tracking_store=store,
      trading_calendar=TradingCalendar(),
      now=lambda: datetime(2026, 10, 20, 10, 30, tzinfo=UTC),
  )

  asyncio.run(store.initialize())
  asyncio.run(store.save(state))
  asyncio.run(service.capture_once())
  loaded = asyncio.run(store.load())

  assert provider.history_calls == 0
  assert loaded.positions[0].price_history == []
