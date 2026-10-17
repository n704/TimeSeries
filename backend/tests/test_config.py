import pytest

from app.config import Settings


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
