from typing import Any


class AppError(Exception):
  def __init__(
      self,
      code: str,
      message: str,
      *,
      status_code: int,
      retryable: bool = False,
      details: dict[str, Any] | None = None,
  ) -> None:
    super().__init__(message)
    self.code = code
    self.message = message
    self.status_code = status_code
    self.retryable = retryable
    self.details = details


class ProviderError(AppError):
  def __init__(self, message: str, *, retryable: bool = True) -> None:
    super().__init__(
        "DATA_PROVIDER_ERROR",
        message,
        status_code=502,
        retryable=retryable,
    )
