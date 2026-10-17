from dataclasses import dataclass
from typing import Protocol

from app.schemas import HistoryMetadata, PricePoint, Security


@dataclass(frozen=True)
class HistoryData:
  security: Security
  prices: list[PricePoint]
  metadata: HistoryMetadata


class MarketDataProvider(Protocol):
  async def search(self, query: str, limit: int) -> list[Security]: ...

  async def history(self, symbol: str, period: str) -> HistoryData: ...

  async def close(self) -> None: ...
