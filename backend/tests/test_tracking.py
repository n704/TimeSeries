import asyncio
import sqlite3
from datetime import UTC, date, datetime

import pytest

from app.schemas import (
    InstrumentType,
    PortfolioPosition,
    Security,
    TrackingState,
    WatchlistItem,
)
from app.services.tracking import SQLiteTrackingStore, TrackingStoreError


def test_sqlite_tracking_store_persists_across_instances(tmp_path) -> None:
  database_path = tmp_path / "tracking.sqlite3"
  security = Security(
      symbol="RELIANCE.NS",
      name="Reliance Industries Limited",
      exchange="NSE",
      currency="INR",
      instrument_type=InstrumentType.COMMON_STOCK,
  )
  state = TrackingState(
      watchlist=[
          WatchlistItem(
              security=security,
              latest_close=1211.2,
              last_market_date="2026-10-16",
              added_at="2026-10-18T00:00:00Z",
          )
      ],
      positions=[
          PortfolioPosition(
              security=security,
              quantity=3,
              average_price=1000,
              latest_close=1211.2,
              last_market_date="2026-10-16",
              updated_at="2026-10-18T00:00:00Z",
          )
      ],
  )

  first = SQLiteTrackingStore(database_path)
  asyncio.run(first.initialize())
  asyncio.run(first.save(state))

  second = SQLiteTrackingStore(database_path)
  asyncio.run(second.initialize())
  loaded = asyncio.run(second.load())

  assert loaded.watchlist[0].security.symbol == "RELIANCE.NS"
  assert loaded.positions[0].quantity == 3
  assert loaded.positions[0].price_history == []
  assert loaded.updated_at is not None


def test_sqlite_tracking_store_keeps_newer_background_prices(tmp_path) -> None:
  database_path = tmp_path / "tracking.sqlite3"
  security = Security(
      symbol="RELIANCE.NS",
      name="Reliance Industries Limited",
      exchange="NSE",
      currency="INR",
      instrument_type=InstrumentType.COMMON_STOCK,
  )
  stale_state = TrackingState(
      positions=[
          PortfolioPosition(
              security=security,
              quantity=3,
              average_price=1000,
              latest_close=1211.2,
              last_market_date="2026-10-16",
              updated_at="2026-10-18T00:00:00Z",
          )
      ],
  )
  store = SQLiteTrackingStore(database_path)

  asyncio.run(store.initialize())
  asyncio.run(store.save(stale_state))
  asyncio.run(
      store.record_price_snapshot(
          "RELIANCE.NS",
          date(2026, 10, 16),
          1211.2,
          datetime(2026, 10, 16, 12, 30, tzinfo=UTC),
      )
  )
  asyncio.run(
      store.record_price_snapshot(
          "RELIANCE.NS",
          date(2026, 10, 19),
          1230.5,
          datetime(2026, 10, 19, 12, 30, tzinfo=UTC),
      )
  )
  saved = asyncio.run(store.save(stale_state))
  loaded = asyncio.run(store.load())

  assert saved.positions[0].latest_close == 1230.5
  assert saved.positions[0].last_market_date == date(2026, 10, 19)
  assert [snapshot.date for snapshot in loaded.positions[0].price_history] == [
      date(2026, 10, 16),
      date(2026, 10, 19),
  ]
  assert loaded.positions[0].price_history[-1].adjusted_close == 1230.5
  exported = asyncio.run(store.export_data())
  assert exported.state.positions[0].security.symbol == "RELIANCE.NS"
  assert [snapshot.market_date for snapshot in exported.snapshots] == [
      date(2026, 10, 16),
      date(2026, 10, 19),
  ]


def test_sqlite_tracking_store_prunes_removed_position_history(tmp_path) -> None:
  database_path = tmp_path / "tracking.sqlite3"
  security = Security(
      symbol="RELIANCE.NS",
      name="Reliance Industries Limited",
      exchange="NSE",
      currency="INR",
  )
  store = SQLiteTrackingStore(database_path)
  asyncio.run(store.initialize())
  asyncio.run(
      store.save(
          TrackingState(
              positions=[
                  PortfolioPosition(
                      security=security,
                      quantity=1,
                      average_price=1000,
                      latest_close=1211.2,
                      last_market_date="2026-10-16",
                      updated_at="2026-10-18T00:00:00Z",
                  )
              ]
          )
      )
  )
  asyncio.run(
      store.record_price_snapshot(
          "RELIANCE.NS",
          date(2026, 10, 16),
          1211.2,
          datetime(2026, 10, 16, 12, 30, tzinfo=UTC),
      )
  )

  asyncio.run(store.save(TrackingState()))

  with sqlite3.connect(database_path) as connection:
    count = connection.execute(
        "SELECT COUNT(*) FROM portfolio_price_snapshots"
    ).fetchone()[0]
  assert count == 0


def test_sqlite_tracking_store_rejects_non_finite_snapshot(tmp_path) -> None:
  store = SQLiteTrackingStore(tmp_path / "tracking.sqlite3")

  asyncio.run(store.initialize())

  with pytest.raises(TrackingStoreError, match="finite and positive"):
    asyncio.run(
        store.record_price_snapshot(
            "RELIANCE.NS",
            date(2026, 10, 16),
            float("inf"),
            datetime(2026, 10, 16, 12, 30, tzinfo=UTC),
        )
    )
