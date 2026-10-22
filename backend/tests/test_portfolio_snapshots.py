import asyncio
from datetime import UTC, date, datetime

import pytest

from app.schemas import PortfolioPosition, Security, TrackingState
from app.services.portfolio_snapshots import (
    PortfolioSnapshotService,
    seconds_until_next_snapshot,
    snapshot_window_is_open,
)
from app.services.tracking import SQLiteTrackingStore
from tests.fakes import FakeMarketDataProvider


def test_snapshot_schedule_targets_six_pm_india_time() -> None:
  before = datetime(2026, 10, 22, 12, 29, tzinfo=UTC)
  after = datetime(2026, 10, 22, 12, 31, tzinfo=UTC)

  assert seconds_until_next_snapshot(before) == 60
  assert seconds_until_next_snapshot(after) == 86_340
  assert snapshot_window_is_open(before) is False
  assert snapshot_window_is_open(after) is True


def test_snapshot_schedule_rejects_naive_time() -> None:
  with pytest.raises(ValueError, match="timezone-aware"):
    seconds_until_next_snapshot(datetime(2026, 10, 22, 18))


def test_snapshot_service_records_latest_market_close(tmp_path) -> None:
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
              last_market_date=date(2026, 5, 29),
              updated_at=datetime(2026, 5, 29, 12, 30, tzinfo=UTC),
          )
      ]
  )
  captured_at = datetime(2026, 5, 30, 12, 30, tzinfo=UTC)
  service = PortfolioSnapshotService(
      provider=provider,
      tracking_store=store,
      now=lambda: captured_at,
  )

  asyncio.run(store.initialize())
  asyncio.run(store.save(state))
  asyncio.run(
      store.record_price_snapshot(
          "RELIANCE.NS",
          date(2026, 5, 29),
          248,
          datetime(2026, 5, 29, 12, 30, tzinfo=UTC),
      )
  )
  asyncio.run(service.capture_once())
  asyncio.run(service.capture_once())
  loaded = asyncio.run(store.load())

  assert provider.history_calls == 1
  assert loaded.positions[0].latest_close == 249
  assert loaded.positions[0].last_market_date == date(2026, 5, 30)
  assert [snapshot.adjusted_close for snapshot in loaded.positions[0].price_history] == [
      248,
      249,
  ]
  assert loaded.positions[0].price_history[-1].captured_at == captured_at
