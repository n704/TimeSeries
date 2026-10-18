import asyncio
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from pydantic import ValidationError

from app.schemas import TrackingState, TrackingStateResponse


class TrackingStoreError(RuntimeError):
  pass


class TrackingStore(Protocol):
  async def initialize(self) -> None: ...

  async def load(self) -> TrackingStateResponse: ...

  async def save(self, state: TrackingState) -> TrackingStateResponse: ...


class SQLiteTrackingStore:
  def __init__(self, database_path: Path) -> None:
    self._database_path = database_path.expanduser().resolve()

  async def initialize(self) -> None:
    await asyncio.to_thread(self._initialize_sync)

  async def load(self) -> TrackingStateResponse:
    return await asyncio.to_thread(self._load_sync)

  async def save(self, state: TrackingState) -> TrackingStateResponse:
    return await asyncio.to_thread(self._save_sync, state)

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
    except (OSError, sqlite3.Error) as error:
      raise TrackingStoreError("Tracking database could not be initialized.") from error

  def _load_sync(self) -> TrackingStateResponse:
    try:
      with self._connect() as connection:
        row = connection.execute(
            "SELECT payload, updated_at FROM tracking_state WHERE id = 1"
        ).fetchone()
    except sqlite3.Error as error:
      raise TrackingStoreError("Tracking data could not be loaded.") from error
    if row is None:
      return TrackingStateResponse()
    try:
      state = TrackingState.model_validate_json(row[0])
      updated_at = datetime.fromisoformat(row[1])
    except (ValidationError, ValueError) as error:
      raise TrackingStoreError("Stored tracking data is invalid.") from error
    return TrackingStateResponse(
        watchlist=state.watchlist,
        positions=state.positions,
        updated_at=updated_at,
    )

  def _save_sync(self, state: TrackingState) -> TrackingStateResponse:
    updated_at = datetime.now(UTC)
    try:
      with self._connect() as connection:
        connection.execute(
            """
            INSERT INTO tracking_state (id, payload, updated_at)
            VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              payload = excluded.payload,
              updated_at = excluded.updated_at
            """,
            (state.model_dump_json(), updated_at.isoformat()),
        )
    except sqlite3.Error as error:
      raise TrackingStoreError("Tracking data could not be saved.") from error
    return TrackingStateResponse(
        watchlist=state.watchlist,
        positions=state.positions,
        updated_at=updated_at,
    )
