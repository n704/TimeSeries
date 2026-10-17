from pathlib import Path

import numpy as np
import pytest

from app.services.forecast import LocalTimesFMAdapter


@pytest.fixture
def anyio_backend() -> str:
  return "asyncio"


def make_adapter(checkpoint_path: Path | None = None) -> LocalTimesFMAdapter:
  return LocalTimesFMAdapter(
      backend="mlx",
      checkpoint_id="google/timesfm-3.0-pytorch",
      checkpoint_path=checkpoint_path,
      device="auto",
      model_version="3.0.2",
      load_timeout_seconds=1,
      forecast_timeout_seconds=1,
  )


@pytest.mark.anyio
async def test_load_requires_a_local_checkpoint() -> None:
  adapter = make_adapter()

  with pytest.raises(RuntimeError, match="TIMESFM_CHECKPOINT_PATH"):
    await adapter.load()


@pytest.mark.anyio
async def test_adapter_maps_timesfm_deciles_to_public_quantiles() -> None:
  class Output:
    forecast = np.asarray([101, 102], dtype=np.float32)
    quantiles = np.asarray(
        [
            [90, 92, 94, 96, 101, 104, 106, 108, 110],
            [91, 93, 95, 97, 102, 105, 107, 109, 111],
        ],
        dtype=np.float32,
    )

  class Forecaster:
    def predict(
        self,
        context: np.ndarray,
        *,
        horizon: int,
        return_quantiles: bool,
    ) -> Output:
      assert context.dtype == np.float32
      assert horizon == 2
      assert return_quantiles
      return Output()

  adapter = make_adapter()
  adapter._forecaster = Forecaster()

  result = await adapter.predict(np.asarray([98, 99, 100], dtype=np.float32), 2)

  assert result.p10 == [90, 91]
  assert result.p50 == [101, 102]
  assert result.p90 == [110, 111]
