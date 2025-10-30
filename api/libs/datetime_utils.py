import abc
import datetime
from typing import Protocol

import pytz


class _NowFunction(Protocol):
    @abc.abstractmethod
    def __call__(self, tz: datetime.timezone | None) -> datetime.datetime:
        pass


# _now_func is a callable with the _NowFunction signature.
# Its sole purpose is to abstract time retrieval, enabling
# developers to mock this behavior in tests and time-dependent scenarios.
_now_func: _NowFunction = datetime.datetime.now


def naive_utc_now() -> datetime.datetime:
    """Return a naive datetime object (without timezone information)
    representing current UTC time.
    """
    return _now_func(datetime.UTC).replace(tzinfo=None)


def parse_time_range(
    start: str | None, end: str | None, tzname: str
) -> tuple[datetime.datetime | None, datetime.datetime | None]:
    """
    Parse time range strings and convert to UTC datetime objects.
    Handles DST ambiguity and non-existent times gracefully.

    Args:
        start: Start time string (YYYY-MM-DD HH:MM)
        end: End time string (YYYY-MM-DD HH:MM)
        tzname: Timezone name

    Returns:
        tuple: (start_datetime_utc, end_datetime_utc)

    Raises:
        ValueError: When time range is invalid or start > end
    """
    tz = pytz.timezone(tzname)
    utc = pytz.utc
    start_dt: datetime.datetime | None = None
    end_dt: datetime.datetime | None = None

    if start:
        dt = datetime.datetime.strptime(start, "%Y-%m-%d %H:%M").replace(second=0)
        try:
            # Explicitly specify is_dst=None to avoid DST ambiguity
            start_dt = tz.localize(dt, is_dst=None).astimezone(utc)
        except ValueError as e:
            raise ValueError(f"Invalid start time format: {e}")
        except pytz.AmbiguousTimeError:
            # If DST ambiguity occurs, use standard time
            start_dt = tz.localize(dt, is_dst=False).astimezone(utc)
        except pytz.NonExistentTimeError:
            # If time doesn't exist (e.g., during DST transition), adjust forward by 1 hour
            dt = dt + datetime.timedelta(hours=1)
            start_dt = tz.localize(dt, is_dst=None).astimezone(utc)

    if end:
        dt = datetime.datetime.strptime(end, "%Y-%m-%d %H:%M").replace(second=0)
        try:
            # Explicitly specify is_dst=None to avoid DST ambiguity
            end_dt = tz.localize(dt, is_dst=None).astimezone(utc)
        except ValueError as e:
            raise ValueError(f"Invalid end time format: {e}")
        except pytz.AmbiguousTimeError:
            # If DST ambiguity occurs, use standard time
            end_dt = tz.localize(dt, is_dst=False).astimezone(utc)
        except pytz.NonExistentTimeError:
            # If time doesn't exist (e.g., during DST transition), adjust forward by 1 hour
            dt = dt + datetime.timedelta(hours=1)
            end_dt = tz.localize(dt, is_dst=None).astimezone(utc)

    # Range validation
    if start_dt and end_dt and start_dt > end_dt:
        raise ValueError("start must be earlier than or equal to end")

    return start_dt, end_dt
