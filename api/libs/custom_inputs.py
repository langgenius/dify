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
    # Use re.fullmatch instead of re.match to reject trailing newlines.
    # In Python, '$' matches at end-of-string OR just before a trailing newline,
    # so re.match accepts "7d\n". re.fullmatch requires the entire
    # string to match. Regression for #39730 (sibling of #39234 / #39548 / #39666).
    if not re.fullmatch(pattern, value.lower()):
        raise ValueError(
            "Invalid time duration format. Use: <number>d (days), <number>h (hours), "
            "<number>m (minutes), or <number>s (seconds). Examples: 7d, 4h, 30m, 30s"
        )

    return value.lower()
