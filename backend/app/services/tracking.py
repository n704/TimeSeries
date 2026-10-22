import asyncio
import sqlite3
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Protocol

from pydantic import ValidationError

from app.schemas import (
    PortfolioPosition,
    PortfolioPositionResponse,
    PortfolioPriceSnapshot,
    TrackingState,
    TrackingStateResponse,
    WatchlistItem,
)

PRICE_HISTORY_LIMIT = 30


class TrackingStoreError(RuntimeError):
  pass


class TrackingStore(Protocol):
  async def initialize(self) -> None: ...

  async def load(self) -> TrackingStateResponse: ...

  async def save(self, state: TrackingState) -> TrackingStateResponse: ...

  async def record_price_snapshot(
      self,
      symbol: str,
      market_date: date,
      adjusted_close: float,
      captured_at: datetime,
  ) -> None: ...


class SQLiteTrackingStore:
  def __init__(self, database_path: Path) -> None:
    self._database_path = database_path.expanduser().resolve()

  async def initialize(self) -> None:
    await asyncio.to_thread(self._initialize_sync)

  async def load(self) -> TrackingStateResponse:
    return await asyncio.to_thread(self._load_sync)

  async def save(self, state: TrackingState) -> TrackingStateResponse:
    return await asyncio.to_thread(self._save_sync, state)

  async def record_price_snapshot(
      self,
      symbol: str,
      market_date: date,
      adjusted_close: float,
      captured_at: datetime,
  ) -> None:
    await asyncio.to_thread(
        self._record_price_snapshot_sync,
        symbol,
        market_date,
        adjusted_close,
        captured_at,
    )

  def _connect(self) -> sqlite3.Connection:
    connection = sqlite3.connect(self._database_path, timeout=10)
    connection.execute("PRAGMA journal_mode = WAL")
    return connection

  def _initialize_sync(self) -> None:
    try:
      self._database_path.parent.mkdir(parents=True, exist_ok=True)
      with self._connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tracking_state (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              payload TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS portfolio_price_snapshots (
              symbol TEXT NOT NULL,
              market_date TEXT NOT NULL,
              adjusted_close REAL NOT NULL CHECK (adjusted_close > 0),
              captured_at TEXT NOT NULL,
              PRIMARY KEY (symbol, market_date)
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_symbol_date
            ON portfolio_price_snapshots (symbol, market_date DESC)
            """
        )
    except (OSError, sqlite3.Error) as error:
      raise TrackingStoreError("Tracking database could not be initialized.") from error

  def _load_sync(self) -> TrackingStateResponse:
    try:
      with self._connect() as connection:
        state, updated_at = self._load_state(connection)
        if state is None:
          return TrackingStateResponse()
        merged_state = self._merge_latest_snapshots(connection, state)
        return self._build_response(connection, merged_state, updated_at)
    except (sqlite3.Error, ValidationError, ValueError) as error:
      raise TrackingStoreError("Tracking data could not be loaded.") from error

  def _save_sync(self, state: TrackingState) -> TrackingStateResponse:
    updated_at = datetime.now(UTC)
    try:
      with self._connect() as connection:
        self._prune_snapshots(connection, state)
        merged_state = self._merge_latest_snapshots(connection, state)
        connection.execute(
            """
            INSERT INTO tracking_state (id, payload, updated_at)
            VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              payload = excluded.payload,
              updated_at = excluded.updated_at
            """,
            (merged_state.model_dump_json(), updated_at.isoformat()),
        )
        return self._build_response(connection, merged_state, updated_at)
    except (sqlite3.Error, ValidationError, ValueError) as error:
      raise TrackingStoreError("Tracking data could not be saved.") from error

  def _record_price_snapshot_sync(
      self,
      symbol: str,
      market_date: date,
      adjusted_close: float,
      captured_at: datetime,
  ) -> None:
    if adjusted_close <= 0:
      raise TrackingStoreError("Portfolio snapshot price must be positive.")
    try:
      with self._connect() as connection:
        state, _ = self._load_state(connection)
        if state is None or not any(
            position.security.symbol == symbol
            for position in state.positions
        ):
          return
        connection.execute(
            """
            INSERT INTO portfolio_price_snapshots (
              symbol,
              market_date,
              adjusted_close,
              captured_at
            )
            VALUES (?, ?, ?, ?)
            ON CONFLICT(symbol, market_date) DO UPDATE SET
              adjusted_close = excluded.adjusted_close,
              captured_at = excluded.captured_at
            """,
            (
                symbol,
                market_date.isoformat(),
                adjusted_close,
                captured_at.isoformat(),
            ),
        )
        updated_at = datetime.now(UTC)
        merged_state = self._merge_latest_snapshots(connection, state)
        connection.execute(
            """
            UPDATE tracking_state
            SET payload = ?, updated_at = ?
            WHERE id = 1
            """,
            (merged_state.model_dump_json(), updated_at.isoformat()),
        )
    except (sqlite3.Error, ValidationError, ValueError) as error:
      raise TrackingStoreError("Portfolio price snapshot could not be saved.") from error

  def _load_state(
      self,
      connection: sqlite3.Connection,
  ) -> tuple[TrackingState | None, datetime | None]:
    row = connection.execute(
        "SELECT payload, updated_at FROM tracking_state WHERE id = 1"
    ).fetchone()
    if row is None:
      return None, None
    return TrackingState.model_validate_json(row[0]), datetime.fromisoformat(row[1])

  def _prune_snapshots(
      self,
      connection: sqlite3.Connection,
      state: TrackingState,
  ) -> None:
    symbols = [position.security.symbol for position in state.positions]
    if not symbols:
      connection.execute("DELETE FROM portfolio_price_snapshots")
      return
    placeholders = ", ".join("?" for _ in symbols)
    connection.execute(
        f"""
        DELETE FROM portfolio_price_snapshots
        WHERE symbol NOT IN ({placeholders})
        """,
        symbols,
    )

  def _merge_latest_snapshots(
      self,
      connection: sqlite3.Connection,
      state: TrackingState,
  ) -> TrackingState:
    symbols = [position.security.symbol for position in state.positions]
    if not symbols:
      return state
    placeholders = ", ".join("?" for _ in symbols)
    rows = connection.execute(
        f"""
        SELECT snapshots.symbol, snapshots.market_date, snapshots.adjusted_close
        FROM portfolio_price_snapshots AS snapshots
        INNER JOIN (
          SELECT symbol, MAX(market_date) AS market_date
          FROM portfolio_price_snapshots
          WHERE symbol IN ({placeholders})
          GROUP BY symbol
        ) AS latest
          ON latest.symbol = snapshots.symbol
         AND latest.market_date = snapshots.market_date
        """,
        symbols,
    ).fetchall()
    latest_by_symbol = {
        symbol: (date.fromisoformat(market_date), adjusted_close)
        for symbol, market_date, adjusted_close in rows
    }

    positions = [
        self._merge_position_snapshot(position, latest_by_symbol)
        for position in state.positions
    ]
    watchlist = [
        self._merge_watchlist_snapshot(item, latest_by_symbol)
        for item in state.watchlist
    ]
    return TrackingState(watchlist=watchlist, positions=positions)

  def _merge_position_snapshot(
      self,
      position: PortfolioPosition,
      latest_by_symbol: dict[str, tuple[date, float]],
  ) -> PortfolioPosition:
    latest = latest_by_symbol.get(position.security.symbol)
    if latest is None or latest[0] < position.last_market_date:
      return position
    return position.model_copy(
        update={
            "last_market_date": latest[0],
            "latest_close": latest[1],
        }
    )

  def _merge_watchlist_snapshot(
      self,
      item: WatchlistItem,
      latest_by_symbol: dict[str, tuple[date, float]],
  ) -> WatchlistItem:
    latest = latest_by_symbol.get(item.security.symbol)
    if latest is None or latest[0] < item.last_market_date:
      return item
    return item.model_copy(
        update={
            "last_market_date": latest[0],
            "latest_close": latest[1],
        }
    )

  def _build_response(
      self,
      connection: sqlite3.Connection,
      state: TrackingState,
      updated_at: datetime | None,
  ) -> TrackingStateResponse:
    histories = self._load_price_histories(
        connection,
        [position.security.symbol for position in state.positions],
    )
    positions = [
        PortfolioPositionResponse(
            **position.model_dump(),
            price_history=histories.get(position.security.symbol, []),
        )
        for position in state.positions
    ]
    return TrackingStateResponse(
        watchlist=state.watchlist,
        positions=positions,
        updated_at=updated_at,
    )

  def _load_price_histories(
      self,
      connection: sqlite3.Connection,
      symbols: list[str],
  ) -> dict[str, list[PortfolioPriceSnapshot]]:
    if not symbols:
      return {}
    placeholders = ", ".join("?" for _ in symbols)
    rows = connection.execute(
        f"""
        SELECT symbol, market_date, adjusted_close, captured_at
        FROM portfolio_price_snapshots
        WHERE symbol IN ({placeholders})
        ORDER BY symbol, market_date DESC
        """,
        symbols,
    ).fetchall()
    histories: dict[str, list[PortfolioPriceSnapshot]] = {
        symbol: [] for symbol in symbols
    }
    for symbol, market_date, adjusted_close, captured_at in rows:
      history = histories[symbol]
      if len(history) >= PRICE_HISTORY_LIMIT:
        continue
      history.append(
          PortfolioPriceSnapshot(
              date=market_date,
              adjusted_close=adjusted_close,
              captured_at=captured_at,
          )
      )
    for history in histories.values():
      history.reverse()
    return histories
