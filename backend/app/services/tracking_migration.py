import argparse
import asyncio
import os
import sys
from pathlib import Path

from app.services.postgres_tracking import PostgresTrackingStore
from app.services.tracking import (
    SQLiteTrackingStore,
    TrackingDataDump,
    TrackingStoreError,
)


async def migrate_tracking_data(
    sqlite_path: Path,
    postgres_url: str,
    *,
    force: bool = False,
) -> TrackingDataDump:
  resolved_sqlite_path = sqlite_path.expanduser().resolve()
  if not resolved_sqlite_path.is_file():
    raise TrackingStoreError(
        f"SQLite tracking database does not exist: {resolved_sqlite_path}"
    )

  source = SQLiteTrackingStore(resolved_sqlite_path)
  source_data = await source.export_data()
  destination = PostgresTrackingStore(postgres_url)
  await destination.initialize()
  await destination.replace_data(source_data, force=force)
  migrated_data = await destination.export_data()
  if migrated_data != source_data:
    raise TrackingStoreError(
        "PostgreSQL verification did not match the SQLite source data."
    )
  return migrated_data


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
      description=(
          "Transactionally migrate local tracking data from SQLite to PostgreSQL."
      )
  )
  parser.add_argument(
      "--sqlite-path",
      type=Path,
      default=Path(
          os.environ.get(
              "TRACKING_DATABASE_PATH",
              "data/tracking.sqlite3",
          )
      ),
      help="SQLite source path (default: TRACKING_DATABASE_PATH).",
  )
  parser.add_argument(
      "--postgres-url",
      default=os.environ.get("TRACKING_DATABASE_URL"),
      help="PostgreSQL URL (default: TRACKING_DATABASE_URL).",
  )
  parser.add_argument(
      "--force",
      action="store_true",
      help="Replace existing PostgreSQL tracking data.",
  )
  args = parser.parse_args()
  if not args.postgres_url:
    parser.error(
        "--postgres-url or the TRACKING_DATABASE_URL environment variable "
        "is required."
    )
  return args


def main() -> int:
  args = parse_args()
  try:
    migrated = asyncio.run(
        migrate_tracking_data(
            args.sqlite_path,
            args.postgres_url,
            force=args.force,
        )
    )
  except TrackingStoreError as error:
    print(f"ERROR: {error}", file=sys.stderr)
    return 1

  print(
      "Migration verified: "
      f"{len(migrated.state.watchlist)} watchlist items, "
      f"{len(migrated.state.positions)} positions, "
      f"{len(migrated.snapshots)} price snapshots."
  )
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
