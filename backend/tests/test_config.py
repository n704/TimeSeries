import pytest

from app.config import Settings
from app.main import create_tracking_store
from app.services.postgres_tracking import PostgresTrackingStore
from app.services.tracking import SQLiteTrackingStore


def test_allowed_origins_accepts_comma_separated_environment_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
  monkeypatch.setenv(
      "ALLOWED_ORIGINS",
      "http://localhost:5173,http://127.0.0.1:5173",
  )

  settings = Settings(_env_file=None)

  assert settings.allowed_origins == [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
  ]


def test_tracking_store_uses_postgres_when_url_is_configured() -> None:
  settings = Settings(
      _env_file=None,
      tracking_database_url="postgresql://timeseries@postgres/timeseries",
  )

  store = create_tracking_store(settings)

  assert isinstance(store, PostgresTrackingStore)


def test_tracking_store_defaults_to_sqlite() -> None:
  settings = Settings(_env_file=None, tracking_database_url=None)

  store = create_tracking_store(settings)

  assert isinstance(store, SQLiteTrackingStore)
