"""Custom input types for Flask-RESTX request parsing."""

import re


def time_duration(value: str) -> str:
    """
    Validate and return time duration string.

    Accepts formats: <number>d (days), <number>h (hours), <number>m (minutes), <number>s (seconds)
    Examples: 7d, 4h, 30m, 30s

    Args:
        value: The time duration string

    Returns:
        The validated time duration string

    Raises:
        ValueError: If the format is invalid
    """
    if not value:
        raise ValueError("Time duration cannot be empty")

    pattern = r"^(\d+)([dhms])$"
    if not re.match(pattern, value.lower()):
        raise ValueError(
            "Invalid time duration format. Use: <number>d (days), <number>h (hours), "
            "<number>m (minutes), or <number>s (seconds). Examples: 7d, 4h, 30m, 30s"
        )

    return value.lower()
