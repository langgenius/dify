import abc
import datetime
from typing import Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pytz.exceptions import UnknownTimeZoneError


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
    try:
        tz = ZoneInfo(tzname)
    except ZoneInfoNotFoundError as exc:
        # Preserve the public error contract: callers and tests expect the same
        # exception type pytz raised for unknown timezone names.
        raise UnknownTimeZoneError(tzname) from exc
    utc = datetime.UTC

    def _parse(time_str: str | None, label: str) -> datetime.datetime | None:
        if not time_str:
            return None

        try:
            dt = datetime.datetime.strptime(time_str, "%Y-%m-%d %H:%M").replace(second=0)
        except ValueError as e:
            raise ValueError(f"Invalid {label} time format: {e}") from e

        # `ZoneInfo` expresses DST transitions via the `fold` attribute instead of
        # pytz's `localize(is_dst=...)`. Reproduce the original behavior:
        #   - ambiguous local time (fall-back): pick standard time (`is_dst=False`,
        #     i.e. `fold=1`, the later of the two wall-clock occurrences);
        #   - non-existent local time (spring-forward): step forward one hour to the
        #     first existing time, which `fold=0` resolves to deterministically.
        dt0 = dt.replace(tzinfo=tz, fold=0)
        dt1 = dt.replace(tzinfo=tz, fold=1)
        offset0 = dt0.utcoffset()
        offset1 = dt1.utcoffset()
        if offset0 is not None and offset1 is not None and offset0 > offset1:
            # Fall-back ambiguity: the earlier offset is DST, prefer standard time.
            return dt1.astimezone(utc)
        return dt0.astimezone(utc)

    start_dt = _parse(start, "start")
    end_dt = _parse(end, "end")

    # Range validation
    if start_dt and end_dt and start_dt > end_dt:
        raise ValueError("start must be earlier than or equal to end")

    return start_dt, end_dt
