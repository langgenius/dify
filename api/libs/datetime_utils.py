import abc
import datetime
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Protocol
from zoneinfo import ZoneInfo


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


def localize_datetime(dt: datetime.datetime, tz: datetime.tzinfo) -> datetime.datetime:
    """Resolve a naive wall-clock datetime in ``tz`` to a valid aware datetime.

    The caller must pass a naive ``dt`` and a fold-aware timezone. An ambiguous
    wall time resolves to its chronologically later occurrence. A non-existent
    wall time shifts forward by the actual offset change while preserving its
    position within the gap. Selecting the candidate with the greater timestamp
    implements both rules; the UTC round trip normalizes a missing wall time to
    the corresponding valid local time.
    """
    candidates = (dt.replace(tzinfo=tz, fold=0), dt.replace(tzinfo=tz, fold=1))
    return max(candidates, key=datetime.datetime.timestamp).astimezone(datetime.UTC).astimezone(tz)


def parse_time_range(
    start: str | None, end: str | None, tzname: str
) -> tuple[datetime.datetime | None, datetime.datetime | None]:
    """
    Parse time range strings and convert to UTC datetime objects.
    Ambiguous bounds resolve to their chronologically later occurrence.
    Non-existent local bounds shift forward by the actual timezone offset
    change, preserving their position within the gap.

    Args:
        start: Start time string (YYYY-MM-DD HH:MM)
        end: End time string (YYYY-MM-DD HH:MM)
        tzname: Timezone name

    Returns:
        tuple: (start_datetime_utc, end_datetime_utc), with None for empty bounds.
            Non-empty bounds are timezone-aware UTC datetimes with start <= end.

    Raises:
        ValueError: When a time format is invalid or the parsed start > end.
        zoneinfo.ZoneInfoNotFoundError: When tzname is not a recognized timezone.
    """
    tz = ZoneInfo(tzname)

    def _parse(time_str: str | None, label: str) -> datetime.datetime | None:
        if not time_str:
            return None

        try:
            dt = datetime.datetime.strptime(time_str, "%Y-%m-%d %H:%M").replace(second=0)
        except ValueError as e:
            raise ValueError(f"Invalid {label} time format: {e}") from e

        return localize_datetime(dt, tz).astimezone(datetime.UTC)

    start_dt = _parse(start, "start")
    end_dt = _parse(end, "end")

    # Range validation
    if start_dt and end_dt and start_dt > end_dt:
        raise ValueError("start must be earlier than or equal to end")

    return start_dt, end_dt
