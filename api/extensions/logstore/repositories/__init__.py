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
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return default
