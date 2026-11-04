"""Unit tests for the time provider's timestamp conversion helper.

``TimestampToLocaltimeTool.timestamp_to_localtime`` accepts a POSIX timestamp
plus an optional timezone name or ``tzinfo`` and returns an aware ``datetime``.
The tests pin the timezone fallbacks and the ``ToolInvokeError`` raised for an
unknown timezone.
"""

from datetime import UTC, datetime, timedelta, timezone

import pytest

from core.tools.builtin_tool.providers.time.tools.timestamp_to_localtime import TimestampToLocaltimeTool
from core.tools.errors import ToolInvokeError


def test_timestamp_to_localtime_uses_named_timezone() -> None:
    result = TimestampToLocaltimeTool.timestamp_to_localtime(0, "Asia/Shanghai")

    assert result == datetime(1970, 1, 1, 8, 0, 0, tzinfo=result.tzinfo)
    assert result is not None
    assert result.utcoffset() == timedelta(hours=8)


def test_timestamp_to_localtime_uses_utc_name() -> None:
    result = TimestampToLocaltimeTool.timestamp_to_localtime(0, "UTC")

    assert result is not None
    assert result == datetime(1970, 1, 1, tzinfo=UTC)


def test_timestamp_to_localtime_accepts_tzinfo_instance() -> None:
    result = TimestampToLocaltimeTool.timestamp_to_localtime(0, timezone(timedelta(hours=2)))

    assert result is not None
    assert result == datetime(1970, 1, 1, 2, tzinfo=timezone(timedelta(hours=2)))


def test_timestamp_to_localtime_converts_known_timestamp() -> None:
    result = TimestampToLocaltimeTool.timestamp_to_localtime(1_704_067_200, "UTC")

    assert result == datetime(2024, 1, 1, tzinfo=UTC)


def test_timestamp_to_localtime_falls_back_to_system_timezone() -> None:
    result = TimestampToLocaltimeTool.timestamp_to_localtime(0)

    assert result is not None
    assert result.tzinfo is not None
    assert result.timestamp() == 0


def test_timestamp_to_localtime_raises_tool_invoke_error_for_unknown_timezone() -> None:
    with pytest.raises(ToolInvokeError):
        TimestampToLocaltimeTool.timestamp_to_localtime(0, "Not/AZone")


def test_timestamp_to_localtime_raises_tool_invoke_error_for_invalid_timestamp() -> None:
    with pytest.raises(ToolInvokeError):
        TimestampToLocaltimeTool.timestamp_to_localtime("not-a-timestamp")  # type: ignore[arg-type]
