import asyncio
from datetime import UTC, date, datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import ValidationError

from app.schemas import PortfolioPriceSnapshot, TrackingState, TrackingStateResponse
from app.services.tracking import (
    PRICE_HISTORY_LIMIT,
    StoredPriceSnapshot,
    TrackingDataDump,
    TrackingStoreError,
    build_tracking_response,
    merge_tracking_state,
    validate_snapshot_price,
)


class PostgresTrackingStore:
  def __init__(self, database_url: str) -> None:
    self._database_url = database_url

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

  async def export_data(self) -> TrackingDataDump:
    return await asyncio.to_thread(self._export_data_sync)

  async def replace_data(
      self,
      data: TrackingDataDump,
      *,
      force: bool = False,
  ) -> None:
    await asyncio.to_thread(self._replace_data_sync, data, force)

  def _connect(self) -> psycopg.Connection[dict[str, Any]]:
    return psycopg.connect(
        self._database_url,
        connect_timeout=10,
        row_factory=dict_row,
    )

  def _initialize_sync(self) -> None:
    try:
      with self._connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tracking_state (
              id SMALLINT PRIMARY KEY CHECK (id = 1),
              payload JSONB NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS portfolio_price_snapshots (
              symbol TEXT NOT NULL,
              market_date DATE NOT NULL,
              adjusted_close DOUBLE PRECISION NOT NULL
                CHECK (adjusted_close > 0),
              captured_at TIMESTAMPTZ NOT NULL,
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
    except psycopg.Error as error:
      raise TrackingStoreError(
          "PostgreSQL tracking database could not be initialized."
      ) from error

  def _load_sync(self) -> TrackingStateResponse:
    try:
      with self._connect() as connection:
        state, updated_at = self._load_state(connection)
        if state is None:
          return TrackingStateResponse()
        merged_state = self._merge_latest_snapshots(connection, state)
        return self._build_response(connection, merged_state, updated_at)
    except (psycopg.Error, ValidationError, TypeError, ValueError) as error:
      raise TrackingStoreError(
          "PostgreSQL tracking data could not be loaded."
      ) from error

  def _save_sync(self, state: TrackingState) -> TrackingStateResponse:
    updated_at = datetime.now(UTC)
    try:
      with self._connect() as connection:
        connection.execute(
            "SELECT id FROM tracking_state WHERE id = 1 FOR UPDATE"
        ).fetchone()
        self._prune_snapshots(connection, state)
        merged_state = self._merge_latest_snapshots(connection, state)
        connection.execute(
            """
            INSERT INTO tracking_state (id, payload, updated_at)
            VALUES (1, %s, %s)
            ON CONFLICT(id) DO UPDATE SET
              payload = excluded.payload,
              updated_at = excluded.updated_at
            """,
            (
                Jsonb(merged_state.model_dump(mode="json")),
                updated_at,
            ),
        )
        return self._build_response(connection, merged_state, updated_at)
    except (psycopg.Error, ValidationError, TypeError, ValueError) as error:
      raise TrackingStoreError(
          "PostgreSQL tracking data could not be saved."
      ) from error

  def _record_price_snapshot_sync(
      self,
      symbol: str,
      market_date: date,
      adjusted_close: float,
      captured_at: datetime,
  ) -> None:
    validate_snapshot_price(adjusted_close)
    try:
      with self._connect() as connection:
        state, _ = self._load_state(connection, for_update=True)
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
            VALUES (%s, %s, %s, %s)
            ON CONFLICT(symbol, market_date) DO UPDATE SET
              adjusted_close = excluded.adjusted_close,
              captured_at = excluded.captured_at
            """,
            (symbol, market_date, adjusted_close, captured_at),
        )
        updated_at = datetime.now(UTC)
        merged_state = self._merge_latest_snapshots(connection, state)
        connection.execute(
            """
            UPDATE tracking_state
            SET payload = %s, updated_at = %s
            WHERE id = 1
            """,
            (
                Jsonb(merged_state.model_dump(mode="json")),
                updated_at,
            ),
        )
    except (psycopg.Error, ValidationError, TypeError, ValueError) as error:
      raise TrackingStoreError(
          "PostgreSQL portfolio price snapshot could not be saved."
      ) from error

  def _export_data_sync(self) -> TrackingDataDump:
    try:
      with self._connect() as connection:
        state, updated_at = self._load_state(connection)
        rows = connection.execute(
            """
            SELECT symbol, market_date, adjusted_close, captured_at
            FROM portfolio_price_snapshots
            ORDER BY symbol, market_date
            """
        ).fetchall()
        snapshots = tuple(
            StoredPriceSnapshot(
                symbol=row["symbol"],
                market_date=row["market_date"],
                adjusted_close=row["adjusted_close"],
                captured_at=row["captured_at"],
            )
            for row in rows
        )
        for snapshot in snapshots:
          validate_snapshot_price(snapshot.adjusted_close)
        return TrackingDataDump(
            state=state or TrackingState(),
            updated_at=updated_at,
            snapshots=snapshots,
        )
    except (psycopg.Error, ValidationError, TypeError, ValueError) as error:
      raise TrackingStoreError(
          "PostgreSQL tracking data could not be exported."
      ) from error

  def _replace_data_sync(
      self,
      data: TrackingDataDump,
      force: bool,
  ) -> None:
    position_symbols = {
        position.security.symbol for position in data.state.positions
    }
    orphaned_symbols = sorted(
        {
            snapshot.symbol
            for snapshot in data.snapshots
            if snapshot.symbol not in position_symbols
        }
    )
    if orphaned_symbols:
      raise TrackingStoreError(
          "SQLite tracking data contains snapshots for positions that do not exist."
      )
    for snapshot in data.snapshots:
      validate_snapshot_price(snapshot.adjusted_close)

    try:
      with self._connect() as connection:
        row = connection.execute(
            """
            SELECT
              EXISTS (SELECT 1 FROM tracking_state)
              OR EXISTS (SELECT 1 FROM portfolio_price_snapshots)
              AS has_data
            """
        ).fetchone()
        if row is not None and row["has_data"] and not force:
          raise TrackingStoreError(
              "PostgreSQL tracking database already contains data. "
              "Use --force to replace it."
          )

        connection.execute("DELETE FROM portfolio_price_snapshots")
        connection.execute("DELETE FROM tracking_state")
        has_state = (
            data.updated_at is not None
            or bool(data.state.watchlist)
            or bool(data.state.positions)
        )
        if has_state:
          connection.execute(
              """
              INSERT INTO tracking_state (id, payload, updated_at)
              VALUES (1, %s, %s)
              """,
              (
                  Jsonb(data.state.model_dump(mode="json")),
                  data.updated_at or datetime.now(UTC),
              ),
          )
        if data.snapshots:
          with connection.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO portfolio_price_snapshots (
                  symbol,
                  market_date,
                  adjusted_close,
                  captured_at
                )
                VALUES (%s, %s, %s, %s)
                """,
                [
                    (
                        snapshot.symbol,
                        snapshot.market_date,
                        snapshot.adjusted_close,
                        snapshot.captured_at,
                    )
                    for snapshot in data.snapshots
                ],
            )
    except TrackingStoreError:
      raise
    except (psycopg.Error, TypeError, ValueError) as error:
      raise TrackingStoreError(
          "SQLite tracking data could not be imported into PostgreSQL."
      ) from error

  def _load_state(
      self,
      connection: psycopg.Connection[dict[str, Any]],
      *,
      for_update: bool = False,
  ) -> tuple[TrackingState | None, datetime | None]:
    lock_clause = " FOR UPDATE" if for_update else ""
    row = connection.execute(
        "SELECT payload, updated_at FROM tracking_state "
        f"WHERE id = 1{lock_clause}"
    ).fetchone()
    if row is None:
      return None, None
    return TrackingState.model_validate(row["payload"]), row["updated_at"]

  def _prune_snapshots(
      self,
      connection: psycopg.Connection[dict[str, Any]],
      state: TrackingState,
  ) -> None:
    symbols = [position.security.symbol for position in state.positions]
    if not symbols:
      connection.execute("DELETE FROM portfolio_price_snapshots")
      return
    connection.execute(
        """
        DELETE FROM portfolio_price_snapshots
        WHERE NOT (symbol = ANY(%s))
        """,
        (symbols,),
    )

  def _merge_latest_snapshots(
      self,
      connection: psycopg.Connection[dict[str, Any]],
      state: TrackingState,
  ) -> TrackingState:
    symbols = [position.security.symbol for position in state.positions]
    if not symbols:
      return state
    rows = connection.execute(
        """
        SELECT DISTINCT ON (symbol)
          symbol,
          market_date,
          adjusted_close
        FROM portfolio_price_snapshots
        WHERE symbol = ANY(%s)
        ORDER BY symbol, market_date DESC
        """,
        (symbols,),
    ).fetchall()
    latest_by_symbol = {
        row["symbol"]: (row["market_date"], row["adjusted_close"])
        for row in rows
    }
    return merge_tracking_state(state, latest_by_symbol)

  def _build_response(
      self,
      connection: psycopg.Connection[dict[str, Any]],
      state: TrackingState,
      updated_at: datetime | None,
  ) -> TrackingStateResponse:
    histories = self._load_price_histories(
        connection,
        [position.security.symbol for position in state.positions],
    )
    return build_tracking_response(state, updated_at, histories)

  def _load_price_histories(
      self,
      connection: psycopg.Connection[dict[str, Any]],
      symbols: list[str],
  ) -> dict[str, list[PortfolioPriceSnapshot]]:
    if not symbols:
      return {}
    rows = connection.execute(
        """
        SELECT symbol, market_date, adjusted_close, captured_at
        FROM portfolio_price_snapshots
        WHERE symbol = ANY(%s)
        ORDER BY symbol, market_date DESC
        """,
        (symbols,),
    ).fetchall()
    histories: dict[str, list[PortfolioPriceSnapshot]] = {
        symbol: [] for symbol in symbols
    }
    for row in rows:
      history = histories[row["symbol"]]
      if len(history) >= PRICE_HISTORY_LIMIT:
        continue
      history.append(
          PortfolioPriceSnapshot(
              date=row["market_date"],
              adjusted_close=row["adjusted_close"],
              captured_at=row["captured_at"],
          )
      )
    for history in histories.values():
      history.reverse()
    return histories
