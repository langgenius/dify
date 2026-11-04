"""Unit tests for the time provider's weekday tool helper.

Only ``WeekdayTool.convert_datetime`` is exercised: it is a pure parser that the
tool uses before formatting the calendar answer, so the tests pin the accepted
input shapes and the ``None`` result for every rejected date.
"""

from datetime import datetime

import pytest

from core.tools.builtin_tool.providers.time.tools.weekday import WeekdayTool


@pytest.mark.parametrize(
    ("year", "month", "day", "expected"),
    [
        (2024, 1, 1, datetime(2024, 1, 1)),
        (2024, 2, 29, datetime(2024, 2, 29)),
        (1999, 12, 31, datetime(1999, 12, 31)),
        ("2024", "1", "1", datetime(2024, 1, 1)),
        (2024, "2", 29, datetime(2024, 2, 29)),
    ],
)
def test_convert_datetime_accepts_valid_dates(year: object, month: object, day: object, expected: datetime) -> None:
    assert WeekdayTool.convert_datetime(year, month, day) == expected


@pytest.mark.parametrize(
    ("year", "month", "day"),
    [
        (None, 1, 1),
        (2024, None, 1),
        (2024, 1, None),
        (0, 1, 1),
        (2024, 0, 1),
        (2024, 13, 1),
        (2024, 1, 0),
        (2024, 1, 32),
        (2023, 2, 29),
        (2024, 2, 30),
        ("not-a-year", 1, 1),
        (2024, "not-a-month", 1),
    ],
)
def test_convert_datetime_returns_none_for_invalid_dates(year: object, month: object, day: object) -> None:
    assert WeekdayTool.convert_datetime(year, month, day) is None
