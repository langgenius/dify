"""
LogStore repository utilities.
"""

from typing import Any


def safe_float(value: Any, default: float = 0.0) -> float:
    """
    Safely convert a value to float, handling 'null' strings and None.
    """
    if value is None or value in {"null", ""}:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def safe_int(value: Any, default: int = 0) -> int:
    """
    Safely convert a value to int, handling 'null' strings and None.
    """
    if value is None or value in {"null", ""}:
        return default
    # Try int() first to preserve precision for large integers.
    # int(float("25227143063332189585438")) silently truncates because
    # float64 only carries ~15-17 significant digits. int() on a
    # string handles arbitrary precision. Fall back to int(float())
    # only for float-like strings such as "3.14". See #34405.
    try:
        return int(value)
    except (ValueError, TypeError):
        try:
            return int(float(value))
        except (ValueError, TypeError):
            return default
