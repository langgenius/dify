import abc
import datetime
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Protocol

import pytz  # type: ignore[import-untyped]


class _NowFunction(Protocol):
    @abc.abstractmethod
    def __call__(self, tz: datetime.timezone | None) -> datetime.datetime:
        pass


# _now_func is a callable with the _NowFunction signature.
# Its sole purpose is to abstract time retrieval, enabling
# developers to mock this behavior in tests and time-dependent scenarios.
_now_func: _NowFunction = datetime.datetime.now


def utc_now() -> datetime.datetime:
    """Return a timezone-aware datetime representing the current UTC time."""
    return _now_func(datetime.UTC)


@dataclass
class Timing:
    started_at: datetime.datetime
    ended_at: datetime.datetime


@contextmanager
def measure_time() -> Generator[Timing]:
    """Time a block in aware UTC; ``ended_at`` is final once the block exits."""
    started_at = utc_now()
    timing = Timing(started_at=started_at, ended_at=started_at)
    try:
        yield timing
    finally:
        timing.ended_at = utc_now()


def naive_utc_now() -> datetime.datetime:
    """Return a naive datetime object (without timezone information)
    representing current UTC time.
    """
    return utc_now().replace(tzinfo=None)


def ensure_naive_utc(dt: datetime.datetime) -> datetime.datetime:
    """Return the datetime as naive UTC (tzinfo=None).

    If the input is timezone-aware, convert to UTC and drop the tzinfo.
    Assumes naive datetimes are already expressed in UTC.
    """
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(datetime.UTC).replace(tzinfo=None)


def to_utc_timestamp(dt: datetime.datetime) -> int:
    """Convert a datetime to Unix epoch seconds, assuming naive values are UTC.

    Persisted datetimes may be returned without timezone information. Treat
    those values as UTC instead of interpreting them in the host timezone.
    """
    return int(ensure_naive_utc(dt).replace(tzinfo=datetime.UTC).timestamp())


def parse_time_range(
    start: str | None, end: str | None, tzname: str
) -> tuple[datetime.datetime | None, datetime.datetime | None]:
    """
    Parse time range strings and convert to UTC datetime objects.
    Ambiguous times use ``is_dst=False``. Non-existent local times shift
    forward by the actual timezone offset change, preserving their position
    within the gap.

    Args:
        start: Start time string (YYYY-MM-DD HH:MM)
        end: End time string (YYYY-MM-DD HH:MM)
        tzname: Timezone name

    Returns:
        tuple: (start_datetime_utc, end_datetime_utc), with None for empty bounds.
            Non-empty bounds are timezone-aware UTC datetimes with start <= end.

    Raises:
        ValueError: When a time format is invalid or the parsed start > end.
        pytz.UnknownTimeZoneError: When tzname is not a recognized timezone.
    """
    tz = pytz.timezone(tzname)
    utc = pytz.utc

    def _parse(time_str: str | None, label: str) -> datetime.datetime | None:
        if not time_str:
            return None

        try:
            dt = datetime.datetime.strptime(time_str, "%Y-%m-%d %H:%M").replace(second=0)
        except ValueError as e:
            raise ValueError(f"Invalid {label} time format: {e}") from e

        try:
            return tz.localize(dt, is_dst=None).astimezone(utc)
        except pytz.AmbiguousTimeError:
            return tz.localize(dt, is_dst=False).astimezone(utc)
        except pytz.NonExistentTimeError:
            # Use the pre-transition offset, then normalize to shift forward
            # by the actual gap size while preserving the position within it.
            return tz.normalize(tz.localize(dt, is_dst=False)).astimezone(utc)

    start_dt = _parse(start, "start")
    end_dt = _parse(end, "end")

    # Range validation
    if start_dt and end_dt and start_dt > end_dt:
        raise ValueError("start must be earlier than or equal to end")

    return start_dt, end_dt
