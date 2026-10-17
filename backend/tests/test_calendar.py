from datetime import date

import pytest

from app.services.calendar import TradingCalendar


@pytest.mark.parametrize("exchange", ["NSE", "BSE"])
def test_indian_calendar_skips_weekends_and_diwali(exchange: str) -> None:
  calendar = TradingCalendar()

  sessions = calendar.next_sessions(exchange, date(2026, 10, 16), 3)

  assert sessions == [
      date(2026, 10, 19),
      date(2026, 10, 21),
      date(2026, 10, 22),
  ]


def test_indian_calendar_rejects_unsupported_exchange() -> None:
  calendar = TradingCalendar()

  with pytest.raises(ValueError, match="Unsupported Indian exchange"):
    calendar.next_sessions("NASDAQ", date(2026, 10, 16), 3)
