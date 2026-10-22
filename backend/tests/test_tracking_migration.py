import asyncio
import os
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from app.schemas import PortfolioPosition, Security, TrackingState, WatchlistItem
from app.services.postgres_tracking import PostgresTrackingStore
from app.services.tracking import (
    SQLiteTrackingStore,
    TrackingDataDump,
    TrackingStoreError,
)
from app.services.tracking_migration import migrate_tracking_data

TEST_POSTGRES_URL = os.environ.get("TEST_POSTGRES_URL")


def test_migration_rejects_a_missing_sqlite_database(tmp_path: Path) -> None:
  with pytest.raises(TrackingStoreError, match="does not exist"):
    asyncio.run(
        migrate_tracking_data(
            tmp_path / "missing.sqlite3",
            "postgresql://unused@127.0.0.1/unused",
        )
    )


@pytest.mark.skipif(
    TEST_POSTGRES_URL is None,
    reason="Set TEST_POSTGRES_URL to run the PostgreSQL integration test.",
)
def test_migration_preserves_sqlite_tracking_data(tmp_path: Path) -> None:
  sqlite_path = tmp_path / "tracking.sqlite3"
  source = SQLiteTrackingStore(sqlite_path)
  security = Security(
      symbol="RELIANCE.NS",
      name="Reliance Industries Limited",
      exchange="NSE",
      currency="INR",
  )
  state = TrackingState(
      watchlist=[
          WatchlistItem(
              security=security,
              latest_close=1211.2,
              last_market_date=date(2026, 10, 16),
              added_at=datetime(2026, 10, 18, tzinfo=UTC),
          )
      ],
      positions=[
          PortfolioPosition(
              security=security,
              quantity=3,
              average_price=1000,
              latest_close=1211.2,
              last_market_date=date(2026, 10, 16),
              updated_at=datetime(2026, 10, 18, tzinfo=UTC),
          )
      ],
  )

  asyncio.run(source.initialize())
  asyncio.run(source.save(state))
  asyncio.run(
      source.record_price_snapshot(
          "RELIANCE.NS",
          date(2026, 10, 19),
          1230.5,
          datetime(2026, 10, 19, 12, 30, tzinfo=UTC),
      )
  )

  destination = PostgresTrackingStore(TEST_POSTGRES_URL or "")
  try:
    migrated = asyncio.run(
        migrate_tracking_data(
            sqlite_path,
            TEST_POSTGRES_URL or "",
            force=True,
        )
    )
    loaded = asyncio.run(destination.load())

    assert len(migrated.state.watchlist) == 1
    assert len(migrated.state.positions) == 1
    assert len(migrated.snapshots) == 1
    assert loaded.positions[0].latest_close == 1230.5
    assert loaded.positions[0].price_history[0].date == date(2026, 10, 19)

    with pytest.raises(TrackingStoreError, match="already contains data"):
      asyncio.run(
          migrate_tracking_data(
              sqlite_path,
              TEST_POSTGRES_URL or "",
          )
      )
  finally:
    asyncio.run(
        destination.replace_data(
            TrackingDataDump(
                state=TrackingState(),
                updated_at=None,
                snapshots=(),
            ),
            force=True,
        )
    )
