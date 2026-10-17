from datetime import date, timedelta

import exchange_calendars


class TradingCalendar:
  def __init__(self) -> None:
    self._calendar = exchange_calendars.get_calendar("XNYS")

  def next_sessions(self, after: date, count: int) -> list[date]:
    start = after + timedelta(days=1)
    end = after + timedelta(days=max(45, count * 3))
    sessions = self._calendar.sessions_in_range(start.isoformat(), end.isoformat())
    dates = [session.date() for session in sessions[:count]]
    if len(dates) != count:
      raise RuntimeError("Unable to create the requested trading-session horizon.")
    return dates
