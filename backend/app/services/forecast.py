import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from app.errors import AppError


@dataclass(frozen=True)
class ModelForecast:
  p10: list[float]
  p50: list[float]
  p90: list[float]


class ForecastModel(Protocol):
  backend_name: str
  model_id: str
  model_version: str

  async def load(self) -> None: ...

  async def predict(self, context: np.ndarray, horizon: int) -> ModelForecast: ...

  async def predict_batch(
      self,
      contexts: list[np.ndarray],
      horizon: int,
  ) -> list[ModelForecast]: ...


class LocalTimesFMAdapter:
  def __init__(
      self,
      *,
      backend: str,
      checkpoint_id: str,
      checkpoint_path: Path | None,
      device: str,
      model_version: str,
      load_timeout_seconds: float,
      forecast_timeout_seconds: float,
  ) -> None:
    self.backend_name = f"local-{backend}"
    self.model_id = checkpoint_id
    self.model_version = model_version
    self._backend = backend
    self._checkpoint_path = checkpoint_path
    self._device = device
    self._load_timeout = load_timeout_seconds
    self._forecast_timeout = forecast_timeout_seconds
    self._forecaster: object | None = None
    self._semaphore = asyncio.Semaphore(1)

  async def load(self) -> None:
    if self._checkpoint_path is None:
      raise RuntimeError(
          "TIMESFM_CHECKPOINT_PATH is required. Download the model during setup "
          "and configure its absolute local path."
      )
    path = self._checkpoint_path.expanduser().resolve()
    if not path.is_dir() or not any(path.iterdir()):
      raise RuntimeError(
          f"TimesFM checkpoint is missing or incomplete at {path}. "
          "Run the documented model download step first."
      )
    try:
      self._forecaster = await asyncio.wait_for(
          asyncio.to_thread(self._load_sync, path),
          timeout=self._load_timeout,
      )
    except TimeoutError as error:
      raise RuntimeError("TimesFM model loading timed out.") from error

  def _load_sync(self, path: Path) -> object:
    if self._backend == "mlx":
      try:
        from timesfm3.mlx import TimesFM3Forecaster
      except ImportError as error:
        raise RuntimeError(
            "TimesFM MLX is not installed. Run `uv sync --extra timesfm-mlx`."
        ) from error
      return TimesFM3Forecaster.from_pretrained(str(path))

    try:
      from timesfm3 import ModelConfig, TimesFM3Evaluator
    except ImportError as error:
      raise RuntimeError(
          "TimesFM PyTorch is not installed. Run `uv sync --extra timesfm-pytorch`."
      ) from error
    device = "cpu" if self._device == "auto" else self._device
    return TimesFM3Evaluator(
        ModelConfig(
            checkpoint_path=str(path),
            per_core_batch_size=1,
            device=device,
        )
    )

  async def predict(self, context: np.ndarray, horizon: int) -> ModelForecast:
    if self._forecaster is None:
      raise AppError(
          "MODEL_NOT_READY",
          "TimesFM is not loaded.",
          status_code=503,
          retryable=True,
      )
    async with self._semaphore:
      try:
        return await asyncio.wait_for(
            asyncio.to_thread(self._predict_sync, context, horizon),
            timeout=self._forecast_timeout,
        )
      except TimeoutError as error:
        raise AppError(
            "FORECAST_TIMEOUT",
            "TimesFM did not finish before the local timeout.",
            status_code=504,
            retryable=True,
        ) from error

  async def predict_batch(
      self,
      contexts: list[np.ndarray],
      horizon: int,
  ) -> list[ModelForecast]:
    if self._forecaster is None:
      raise AppError(
          "MODEL_NOT_READY",
          "TimesFM is not loaded.",
          status_code=503,
          retryable=True,
      )
    if not contexts:
      return []
    async with self._semaphore:
      try:
        return await asyncio.wait_for(
            asyncio.to_thread(self._predict_batch_sync, contexts, horizon),
            timeout=self._forecast_timeout,
        )
      except TimeoutError as error:
        raise AppError(
            "FORECAST_TIMEOUT",
            "TimesFM did not finish before the local timeout.",
            status_code=504,
            retryable=True,
        ) from error

  def _predict_sync(self, context: np.ndarray, horizon: int) -> ModelForecast:
    if self._backend == "mlx":
      output = self._forecaster.predict(  # type: ignore[union-attr]
          context,
          horizon=horizon,
          return_quantiles=True,
      )
    else:
      output = list(
          self._forecaster.predict_batch(  # type: ignore[union-attr]
              [context],
              horizon=horizon,
              return_quantiles=True,
              use_symmetric_averaging=False,
          )
      )[0]

    return self._normalize_output(output, horizon)

  def _predict_batch_sync(
      self,
      contexts: list[np.ndarray],
      horizon: int,
  ) -> list[ModelForecast]:
    outputs = list(
        self._forecaster.predict_batch(  # type: ignore[union-attr]
            contexts,
            horizon=horizon,
            return_quantiles=True,
            use_symmetric_averaging=False,
        )
    )
    if len(outputs) != len(contexts):
      raise AppError(
          "MODEL_OUTPUT_INVALID",
          "TimesFM returned an unexpected batch size.",
          status_code=500,
          retryable=True,
      )
    return [self._normalize_output(output, horizon) for output in outputs]

  def _normalize_output(self, output: object, horizon: int) -> ModelForecast:
    point = np.asarray(output.forecast, dtype=np.float64)  # type: ignore[attr-defined]
    quantiles = np.asarray(output.quantiles, dtype=np.float64)
    if point.shape != (horizon,) or quantiles.shape != (horizon, 9):
      raise AppError(
          "MODEL_OUTPUT_INVALID",
          "TimesFM returned an unexpected output shape.",
          status_code=500,
          retryable=True,
      )
    p10, p50, p90 = quantiles[:, 0], quantiles[:, 4], quantiles[:, 8]
    values = np.concatenate((p10, p50, p90))
    if not np.all(np.isfinite(values)) or np.any(values <= 0):
      raise AppError(
          "MODEL_OUTPUT_INVALID",
          "TimesFM returned invalid forecast values.",
          status_code=500,
          retryable=True,
      )
    if np.any(p10 > p50) or np.any(p50 > p90):
      raise AppError(
          "MODEL_OUTPUT_INVALID",
          "TimesFM returned unordered forecast quantiles.",
          status_code=500,
          retryable=True,
      )
    return ModelForecast(
        p10=p10.tolist(),
        p50=p50.tolist(),
        p90=p90.tolist(),
    )
