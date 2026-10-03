"""Custom input types for Flask-RESTX request parsing."""

import re

from libs.time_parser import get_time_threshold


def time_duration(value: str) -> str:
    """
    Validate and return time duration string.

    Accepts formats: <number>d (days), <number>h (hours), <number>m (minutes), <number>s (seconds)
    Examples: 7d, 4h, 30m, 30s
    The duration must produce a representable datetime threshold relative to now.

    Args:
        value: The time duration string

    Returns:
        The validated time duration string

    Raises:
        ValueError: If the format is invalid or the time range cannot be represented
    """
    if not value:
        raise ValueError("Time duration cannot be empty")

    pattern = r"^(\d+)([dhms])$"
    if not re.match(pattern, value.lower()):
        raise ValueError(
            "Invalid time duration format. Use: <number>d (days), <number>h (hours), "
            "<number>m (minutes), or <number>s (seconds). Examples: 7d, 4h, 30m, 30s"
        )

    try:
        get_time_threshold(value)
    except (OverflowError, ValueError) as error:
        raise ValueError("Time duration is out of supported range") from error

    return value.lower()
