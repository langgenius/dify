import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pytest

from libs.datetime_utils import (
    Timing,
    localize_datetime,
    measure_time,
    naive_utc_now,
    parse_time_range,
    to_utc_timestamp,
    utc_now,
)


def test_utc_now(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = datetime.datetime(2026, 8, 26, 12, tzinfo=datetime.UTC)

    def _now_func(tz: datetime.timezone | None) -> datetime.datetime:
        return expected.astimezone(tz)

    monkeypatch.setattr("libs.datetime_utils._now_func", _now_func)

    assert utc_now() == expected
    assert utc_now().tzinfo is datetime.UTC


def test_naive_utc_now(monkeypatch: pytest.MonkeyPatch) -> None:
    tz_aware_utc_now = datetime.datetime.now(tz=datetime.UTC)

    def _now_func(tz: datetime.timezone | None) -> datetime.datetime:
        return tz_aware_utc_now.astimezone(tz)

    monkeypatch.setattr("libs.datetime_utils._now_func", _now_func)

    naive_datetime = naive_utc_now()

    assert naive_datetime.tzinfo is None
    assert naive_datetime.date() == tz_aware_utc_now.date()
    naive_time = naive_datetime.time()
    utc_time = tz_aware_utc_now.time()
    assert naive_time == utc_time


@pytest.mark.parametrize(
    "value",
    [
        datetime.datetime(2024, 1, 1),
        datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC),
        datetime.datetime(2024, 1, 1, 9, tzinfo=datetime.timezone(datetime.timedelta(hours=9))),
    ],
)
def test_to_utc_timestamp(value: datetime.datetime) -> None:
    assert to_utc_timestamp(value) == 1704067200


def test_measure_time_yields_aware_utc_timing() -> None:
    with measure_time() as timer:
        pass

    assert timer.started_at.tzinfo is datetime.UTC
    assert timer.ended_at.tzinfo is datetime.UTC
    assert timer.ended_at >= timer.started_at


def test_measure_time_records_end_when_block_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    started_at = datetime.datetime(2026, 8, 26, 12, tzinfo=datetime.UTC)
    ended_at = started_at + datetime.timedelta(seconds=2)
    clock = iter([started_at, ended_at])
    monkeypatch.setattr("libs.datetime_utils._now_func", lambda tz: next(clock).astimezone(tz))

    with pytest.raises(RuntimeError, match="boom"), measure_time() as timer:
        raise RuntimeError("boom")

    assert timer == Timing(started_at=started_at, ended_at=ended_at)


@pytest.mark.parametrize(
    ("naive", "tzname", "expected_local", "expected_utc"),
    [
        # Unambiguous wall time
        (
            datetime.datetime(2024, 1, 1, 10, 0),
            "Asia/Shanghai",
            datetime.datetime(2024, 1, 1, 10, 0),
            datetime.datetime(2024, 1, 1, 2, 0),
        ),
        # Ambiguous (fall back): later occurrence, 01:30 EST
        (
            datetime.datetime(2024, 11, 3, 1, 30),
            "America/New_York",
            datetime.datetime(2024, 11, 3, 1, 30),
            datetime.datetime(2024, 11, 3, 6, 30),
        ),
        # Nonexistent (spring forward): shifted past the gap, 03:30 EDT
        (
            datetime.datetime(2024, 3, 10, 2, 30),
            "America/New_York",
            datetime.datetime(2024, 3, 10, 3, 30),
            datetime.datetime(2024, 3, 10, 7, 30),
        ),
        # Negative-DST fall back: choose the later GMT occurrence
        (
            datetime.datetime(2024, 10, 27, 1, 30),
            "Europe/Dublin",
            datetime.datetime(2024, 10, 27, 1, 30),
            datetime.datetime(2024, 10, 27, 1, 30),
        ),
        # Negative-DST spring gap: shift 01:30 forward to 02:30 IST
        (
            datetime.datetime(2024, 3, 31, 1, 30),
            "Europe/Dublin",
            datetime.datetime(2024, 3, 31, 2, 30),
            datetime.datetime(2024, 3, 31, 1, 30),
        ),
        # 30-minute spring gap: shift 02:15 forward to 02:45 LHDT
        (
            datetime.datetime(2024, 10, 6, 2, 15),
            "Australia/Lord_Howe",
            datetime.datetime(2024, 10, 6, 2, 45),
            datetime.datetime(2024, 10, 5, 15, 45),
        ),
        # Two-hour spring gap: shift 01:30 forward to 03:30 CEST
        (
            datetime.datetime(2024, 3, 31, 1, 30),
            "Antarctica/Troll",
            datetime.datetime(2024, 3, 31, 3, 30),
            datetime.datetime(2024, 3, 31, 1, 30),
        ),
    ],
)
def test_localize_datetime(
    naive: datetime.datetime, tzname: str, expected_local: datetime.datetime, expected_utc: datetime.datetime
) -> None:
    localized = localize_datetime(naive, ZoneInfo(tzname))

    assert localized.tzinfo == ZoneInfo(tzname)
    assert localized.replace(tzinfo=None) == expected_local
    assert localized.astimezone(datetime.UTC) == expected_utc.replace(tzinfo=datetime.UTC)


class TestParseTimeRange:
    """Test cases for parse_time_range function."""

    def test_parse_time_range_basic(self) -> None:
        """Test basic time range parsing."""
        start, end = parse_time_range("2024-01-01 10:00", "2024-01-01 18:00", "UTC")

        assert start is not None
        assert end is not None
        assert start < end
        assert start.tzinfo == datetime.UTC
        assert end.tzinfo == datetime.UTC

    def test_parse_time_range_start_only(self) -> None:
        """Test parsing with only start time."""
        start, end = parse_time_range("2024-01-01 10:00", None, "UTC")

        assert start is not None
        assert end is None
        assert start.tzinfo == datetime.UTC

    def test_parse_time_range_end_only(self) -> None:
        """Test parsing with only end time."""
        start, end = parse_time_range(None, "2024-01-01 18:00", "UTC")

        assert start is None
        assert end is not None
        assert end.tzinfo == datetime.UTC

    def test_parse_time_range_both_none(self) -> None:
        """Test parsing with both times None."""
        start, end = parse_time_range(None, None, "UTC")

        assert start is None
        assert end is None

    def test_parse_time_range_different_timezones(self) -> None:
        """Test parsing with different timezones."""
        # Test with US/Eastern timezone
        start, end = parse_time_range("2024-01-01 10:00", "2024-01-01 18:00", "US/Eastern")

        assert start is not None
        assert end is not None
        assert start.tzinfo == datetime.UTC
        assert end.tzinfo == datetime.UTC
        # Verify the times are correctly converted to UTC
        assert start.hour == 15  # 10 AM EST = 3 PM UTC (in January)
        assert end.hour == 23  # 6 PM EST = 11 PM UTC (in January)

    def test_parse_time_range_invalid_start_format(self) -> None:
        """Test parsing with invalid start time format."""
        with pytest.raises(ValueError, match="time data.*does not match format"):
            parse_time_range("invalid-date", "2024-01-01 18:00", "UTC")

    def test_parse_time_range_invalid_end_format(self) -> None:
        """Test parsing with invalid end time format."""
        with pytest.raises(ValueError, match="time data.*does not match format"):
            parse_time_range("2024-01-01 10:00", "invalid-date", "UTC")

    def test_parse_time_range_invalid_timezone(self) -> None:
        """Test parsing with invalid timezone."""
        with pytest.raises(ZoneInfoNotFoundError):
            parse_time_range("2024-01-01 10:00", "2024-01-01 18:00", "Invalid/Timezone")

    def test_parse_time_range_start_after_end(self) -> None:
        """Test parsing with start time after end time."""
        with pytest.raises(ValueError, match="start must be earlier than or equal to end"):
            parse_time_range("2024-01-01 18:00", "2024-01-01 10:00", "UTC")

    def test_parse_time_range_start_equals_end(self) -> None:
        """Test parsing with start time equal to end time."""
        start, end = parse_time_range("2024-01-01 10:00", "2024-01-01 10:00", "UTC")

        assert start is not None
        assert end is not None
        assert start == end

    @pytest.mark.parametrize(
        ("tzname", "time_str", "expected"),
        [
            pytest.param(
                "America/New_York",
                "2024-11-03 01:30",
                datetime.datetime(2024, 11, 3, 6, 30, tzinfo=datetime.UTC),
                id="positive-dst",
            ),
            pytest.param(
                "Europe/Dublin",
                "2024-10-27 01:30",
                datetime.datetime(2024, 10, 27, 1, 30, tzinfo=datetime.UTC),
                id="negative-dst",
            ),
        ],
    )
    def test_parse_time_range_ambiguous_local_time_uses_later_occurrence(
        self, tzname: str, time_str: str, expected: datetime.datetime
    ) -> None:
        start, end = parse_time_range(time_str, time_str, tzname)

        assert start == end == expected

    @pytest.mark.parametrize(
        ("tzname", "time_str", "expected"),
        [
            pytest.param(
                "America/New_York",
                "2024-03-10 02:30",
                datetime.datetime(2024, 3, 10, 7, 30, tzinfo=datetime.UTC),
                id="one-hour-gap",
            ),
            pytest.param(
                "Australia/Lord_Howe",
                "2024-10-06 02:15",
                datetime.datetime(2024, 10, 5, 15, 45, tzinfo=datetime.UTC),
                id="half-hour-gap",
            ),
            pytest.param(
                "Antarctica/Troll",
                "2024-03-31 01:30",
                datetime.datetime(2024, 3, 31, 1, 30, tzinfo=datetime.UTC),
                id="two-hour-gap",
            ),
            pytest.param(
                "Pacific/Apia",
                "2011-12-30 12:00",
                datetime.datetime(2011, 12, 30, 22, tzinfo=datetime.UTC),
                id="skipped-day",
            ),
            pytest.param(
                "Europe/Dublin",
                "2024-03-31 01:30",
                datetime.datetime(2024, 3, 31, 1, 30, tzinfo=datetime.UTC),
                id="negative-dst",
            ),
            pytest.param(
                "Asia/Kathmandu",
                "1986-01-01 00:05",
                datetime.datetime(1985, 12, 31, 18, 35, tzinfo=datetime.UTC),
                id="non-dst-quarter-hour-gap",
            ),
        ],
    )
    def test_parse_time_range_nonexistent_local_time(
        self, tzname: str, time_str: str, expected: datetime.datetime
    ) -> None:
        """Both bounds shift forward by the real gap size and resolve to exact UTC instants."""
        start, end = parse_time_range(time_str, time_str, tzname)

        assert start is not None
        assert end is not None
        assert start == end == expected
        assert start.tzinfo == end.tzinfo == datetime.UTC

    def test_parse_time_range_edge_cases(self) -> None:
        """Test edge cases for time parsing."""
        # Test with midnight times
        start, end = parse_time_range("2024-01-01 00:00", "2024-01-01 23:59", "UTC")
        assert start is not None
        assert end is not None
        assert start.hour == 0
        assert start.minute == 0
        assert end.hour == 23
        assert end.minute == 59

    def test_parse_time_range_different_dates(self) -> None:
        """Test parsing with different dates."""
        start, end = parse_time_range("2024-01-01 10:00", "2024-01-02 10:00", "UTC")
        assert start is not None
        assert end is not None
        assert start.date() != end.date()
        assert (end - start).days == 1

    def test_parse_time_range_seconds_handling(self) -> None:
        """Test that seconds are properly set to 0."""
        start, end = parse_time_range("2024-01-01 10:30", "2024-01-01 18:45", "UTC")
        assert start is not None
        assert end is not None
        assert start.second == 0
        assert end.second == 0

    def test_parse_time_range_timezone_conversion_accuracy(self) -> None:
        """Test accurate timezone conversion."""
        # Test with a known timezone conversion
        start, end = parse_time_range("2024-01-01 12:00", "2024-01-01 12:00", "Asia/Tokyo")

        assert start is not None
        assert end is not None
        assert start.tzinfo == datetime.UTC
        assert end.tzinfo == datetime.UTC
        # Tokyo is UTC+9, so 12:00 JST = 03:00 UTC
        assert start.hour == 3
        assert end.hour == 3

    def test_parse_time_range_summer_time(self) -> None:
        """Test parsing during summer time (DST)."""
        # Test with US/Eastern during summer (EDT = UTC-4)
        start, end = parse_time_range("2024-07-01 12:00", "2024-07-01 12:00", "US/Eastern")

        assert start is not None
        assert end is not None
        assert start.tzinfo == datetime.UTC
        assert end.tzinfo == datetime.UTC
        # 12:00 EDT = 16:00 UTC
        assert start.hour == 16
        assert end.hour == 16

    def test_parse_time_range_winter_time(self) -> None:
        """Test parsing during winter time (standard time)."""
        # Test with US/Eastern during winter (EST = UTC-5)
        start, end = parse_time_range("2024-01-01 12:00", "2024-01-01 12:00", "US/Eastern")

        assert start is not None
        assert end is not None
        assert start.tzinfo == datetime.UTC
        assert end.tzinfo == datetime.UTC
        # 12:00 EST = 17:00 UTC
        assert start.hour == 17
        assert end.hour == 17

    def test_parse_time_range_empty_strings(self) -> None:
        """Test parsing with empty strings."""
        # Empty strings are treated as None, so they should not raise errors
        start, end = parse_time_range("", "2024-01-01 18:00", "UTC")
        assert start is None
        assert end is not None

        start, end = parse_time_range("2024-01-01 10:00", "", "UTC")
        assert start is not None
        assert end is None

    def test_parse_time_range_malformed_datetime(self) -> None:
        """Test parsing with malformed datetime strings."""
        with pytest.raises(ValueError, match="time data.*does not match format"):
            parse_time_range("2024-13-01 10:00", "2024-01-01 18:00", "UTC")

        with pytest.raises(ValueError, match="time data.*does not match format"):
            parse_time_range("2024-01-01 10:00", "2024-01-32 18:00", "UTC")

    def test_parse_time_range_very_long_time_range(self) -> None:
        """Test parsing with very long time range."""
        start, end = parse_time_range("2020-01-01 00:00", "2030-12-31 23:59", "UTC")

        assert start is not None
        assert end is not None
        assert start < end
        assert (end - start).days > 3000  # More than 8 years

    def test_parse_time_range_negative_timezone(self) -> None:
        """Test parsing with negative timezone offset."""
        start, end = parse_time_range("2024-01-01 12:00", "2024-01-01 12:00", "America/New_York")

        assert start is not None
        assert end is not None
        assert start.tzinfo == datetime.UTC
        assert end.tzinfo == datetime.UTC
