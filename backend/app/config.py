from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
  model_config = SettingsConfigDict(
      env_file=(".env", "../.env"),
      env_file_encoding="utf-8",
      extra="ignore",
  )

  app_env: Literal["development", "test"] = "development"
  allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]
  market_data_provider: Literal["yahoo"] = "yahoo"
  timesfm_backend: Literal["mlx", "pytorch"] = "mlx"
  timesfm_checkpoint_id: str = "google/timesfm-3.0-pytorch"
  timesfm_checkpoint_path: Path | None = None
  timesfm_device: str = "auto"
  timesfm_model_version: str = "3.0.2"
  model_load_timeout_seconds: float = Field(default=180, gt=0)
  forecast_timeout_seconds: float = Field(default=30, gt=0)
  request_timeout_seconds: float = Field(default=15, gt=0)
  min_history_observations: int = Field(default=120, ge=20)

  @field_validator("allowed_origins", mode="before")
  @classmethod
  def parse_origins(cls, value: object) -> object:
    if isinstance(value, str) and not value.lstrip().startswith("["):
      return [origin.strip() for origin in value.split(",") if origin.strip()]
    return value


@lru_cache
def get_settings() -> Settings:
  return Settings()
