import asyncio

from app.schemas import (
    InstrumentType,
    PortfolioPosition,
    Security,
    TrackingState,
    WatchlistItem,
)
from app.services.tracking import SQLiteTrackingStore


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
  assert loaded.updated_at is not None
