from datetime import date, timedelta

import pandas_market_calendars


class TradingCalendar:
  def __init__(self) -> None:
    self._calendars = {
        "NSE": pandas_market_calendars.get_calendar("NSE"),
        "BSE": pandas_market_calendars.get_calendar("BSE"),
    }

  def is_session(self, exchange: str, on: date) -> bool:
    calendar = self._calendar_for(exchange)
    sessions = calendar.valid_days(
        start_date=on.isoformat(),
        end_date=on.isoformat(),
    )
    return not sessions.empty

  def next_sessions(self, exchange: str, after: date, count: int) -> list[date]:
    calendar = self._calendar_for(exchange)
    start = after + timedelta(days=1)
    end = after + timedelta(days=max(45, count * 3))
    sessions = calendar.valid_days(
        start_date=start.isoformat(),
        end_date=end.isoformat(),
    )
    dates = [session.date() for session in sessions[:count]]
    if len(dates) != count:
      raise RuntimeError("Unable to create the requested trading-session horizon.")
    return dates

  def _calendar_for(self, exchange: str):
    calendar = self._calendars.get(exchange)
    if calendar is None:
      raise ValueError(f"Unsupported Indian exchange: {exchange}")
    return calendar
