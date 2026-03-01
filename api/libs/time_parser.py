"""Time duration parser utility."""

import re
from datetime import UTC, datetime, timedelta


def parse_time_duration(duration_str: str) -> timedelta | None:
    """
    Parse time duration string to timedelta.

    Supported formats:
    - 7d: 7 days
    - 4h: 4 hours
    - 30m: 30 minutes
    - 30s: 30 seconds

    Args:
        duration_str: Duration string (e.g., "7d", "4h", "30m", "30s")

    Returns:
        timedelta object or None if invalid format
    """
    if not duration_str:
        return None

    # Pattern: number followed by unit (d, h, m, s)
    pattern = r"^(\d+)([dhms])$"
    match = re.match(pattern, duration_str.lower())

    if not match:
        return None

    value = int(match.group(1))
    unit = match.group(2)

    if unit == "d":
        return timedelta(days=value)
    elif unit == "h":
        return timedelta(hours=value)
    elif unit == "m":
        return timedelta(minutes=value)
    elif unit == "s":
        return timedelta(seconds=value)

    return None


def get_time_threshold(duration_str: str | None) -> datetime | None:
    """
    Get datetime threshold from duration string.

    Calculates the datetime that is duration_str ago from now.

    Args:
        duration_str: Duration string (e.g., "7d", "4h", "30m", "30s")

    Returns:
        datetime object representing the threshold time, or None if no duration
    """
    if not duration_str:
        return None

    duration = parse_time_duration(duration_str)
    if duration is None:
        return None

    return datetime.now(UTC) - duration
