"""Unit tests for the time provider's timezone conversion helper.

``TimezoneConversionTool.timezone_convert`` is the pure part of the tool: it
parses ``%Y-%m-%d %H:%M:%S`` in a source timezone and returns the same format in
a target timezone, raising ``ToolInvokeError`` for unparsable input so the tool
layer can surface a readable failure.
"""

import pytest

from core.tools.builtin_tool.providers.time.tools.timezone_conversion import TimezoneConversionTool
from core.tools.errors import ToolInvokeError


@pytest.mark.parametrize(
    ("current_time", "source_timezone", "target_timezone", "expected"),
    [
        ("2024-01-01 10:00:00", "Asia/Shanghai", "Asia/Tokyo", "2024-01-01 11:00:00"),
        ("2024-01-01 10:00:00", "Asia/Tokyo", "Asia/Shanghai", "2024-01-01 09:00:00"),
        ("2024-01-15 12:00:00", "America/New_York", "UTC", "2024-01-15 17:00:00"),
        ("2024-07-15 12:00:00", "America/New_York", "UTC", "2024-07-15 16:00:00"),
        ("2024-01-01 00:00:00", "UTC", "UTC", "2024-01-01 00:00:00"),
        ("2024-12-31 23:30:00", "UTC", "Asia/Shanghai", "2025-01-01 07:30:00"),
    ],
)
def test_timezone_convert_returns_formatted_target_time(
    current_time: str, source_timezone: str, target_timezone: str, expected: str
) -> None:
    assert TimezoneConversionTool.timezone_convert(current_time, source_timezone, target_timezone) == expected


@pytest.mark.parametrize(
    ("current_time", "source_timezone", "target_timezone"),
    [
        ("2024-01-01 10:00:00", "Not/AZone", "UTC"),
        ("2024-01-01 10:00:00", "UTC", "Not/AZone"),
        ("2024/01/01 10:00:00", "UTC", "UTC"),
        ("2024-02-30 10:00:00", "UTC", "UTC"),
        ("not-a-time", "UTC", "UTC"),
    ],
)
def test_timezone_convert_raises_tool_invoke_error_for_invalid_input(
    current_time: str, source_timezone: str, target_timezone: str
) -> None:
    with pytest.raises(ToolInvokeError):
        TimezoneConversionTool.timezone_convert(current_time, source_timezone, target_timezone)
