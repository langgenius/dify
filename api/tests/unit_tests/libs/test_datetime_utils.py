import datetime
from unittest.mock import patch

import pytest
import pytz

from libs.datetime_utils import naive_utc_now, parse_time_range


def test_naive_utc_now(monkeypatch: pytest.MonkeyPatch):
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


class TestParseTimeRange:
    """Test cases for parse_time_range function."""

    def test_parse_time_range_basic(self):
        """Test basic time range parsing."""
        start, end = parse_time_range("2024-01-01 10:00", "2024-01-01 18:00", "UTC")

        assert start is not None
        assert end is not None
        assert start < end
        assert start.tzinfo == pytz.UTC
        assert end.tzinfo == pytz.UTC

    def test_parse_time_range_start_only(self):
        """Test parsing with only start time."""
        start, end = parse_time_range("2024-01-01 10:00", None, "UTC")

        assert start is not None
        assert end is None
        assert start.tzinfo == pytz.UTC

    def test_parse_time_range_end_only(self):
        """Test parsing with only end time."""
        start, end = parse_time_range(None, "2024-01-01 18:00", "UTC")

        assert start is None
        assert end is not None
        assert end.tzinfo == pytz.UTC

    def test_parse_time_range_both_none(self):
        """Test parsing with both times None."""
        start, end = parse_time_range(None, None, "UTC")

        assert start is None
        assert end is None

    def test_parse_time_range_different_timezones(self):
        """Test parsing with different timezones."""
        # Test with US/Eastern timezone
        start, end = parse_time_range("2024-01-01 10:00", "2024-01-01 18:00", "US/Eastern")

        assert start is not None
        assert end is not None
        assert start.tzinfo == pytz.UTC
        assert end.tzinfo == pytz.UTC
        # Verify the times are correctly converted to UTC
        assert start.hour == 15  # 10 AM EST = 3 PM UTC (in January)
        assert end.hour == 23  # 6 PM EST = 11 PM UTC (in January)

    def test_parse_time_range_invalid_start_format(self):
        """Test parsing with invalid start time format."""
        with pytest.raises(ValueError, match="time data.*does not match format"):
            parse_time_range("invalid-date", "2024-01-01 18:00", "UTC")

    def test_parse_time_range_invalid_end_format(self):
        """Test parsing with invalid end time format."""
        with pytest.raises(ValueError, match="time data.*does not match format"):
            parse_time_range("2024-01-01 10:00", "invalid-date", "UTC")

    def test_parse_time_range_invalid_timezone(self):
        """Test parsing with invalid timezone."""
        with pytest.raises(pytz.exceptions.UnknownTimeZoneError):
            parse_time_range("2024-01-01 10:00", "2024-01-01 18:00", "Invalid/Timezone")

    def test_parse_time_range_start_after_end(self):
        """Test parsing with start time after end time."""
        with pytest.raises(ValueError, match="start must be earlier than or equal to end"):
            parse_time_range("2024-01-01 18:00", "2024-01-01 10:00", "UTC")

    def test_parse_time_range_start_equals_end(self):
        """Test parsing with start time equal to end time."""
        start, end = parse_time_range("2024-01-01 10:00", "2024-01-01 10:00", "UTC")

        assert start is not None
        assert end is not None
        assert start == end

    def test_parse_time_range_dst_ambiguous_time(self):
        """Test parsing during DST ambiguous time (fall back)."""
        # This test simulates DST fall back where 2:30 AM occurs twice
        with patch("pytz.timezone") as mock_timezone:
            # Mock timezone that raises AmbiguousTimeError
            mock_tz = mock_timezone.return_value

            # Create a mock datetime object for the return value
            mock_dt = datetime.datetime(2024, 1, 1, 10, 0, 0)
            mock_utc_dt = mock_dt.replace(tzinfo=pytz.UTC)

            # Create a proper mock for the localized datetime
            from unittest.mock import MagicMock

            mock_localized_dt = MagicMock()
            mock_localized_dt.astimezone.return_value = mock_utc_dt

            # Set up side effects: first call raises exception, second call succeeds
            mock_tz.localize.side_effect = [
                pytz.AmbiguousTimeError("Ambiguous time"),  # First call for start
                mock_localized_dt,  # Second call for start (with is_dst=False)
                pytz.AmbiguousTimeError("Ambiguous time"),  # First call for end
                mock_localized_dt,  # Second call for end (with is_dst=False)
            ]

            start, end = parse_time_range("2024-01-01 10:00", "2024-01-01 18:00", "US/Eastern")

            # Should use is_dst=False for ambiguous times
            assert mock_tz.localize.call_count == 4  # 2 calls per time (first fails, second succeeds)
            assert start is not None
            assert end is not None

    def test_parse_time_range_dst_nonexistent_time(self):
        """Test parsing during DST nonexistent time (spring forward)."""
        with patch("pytz.timezone") as mock_timezone:
            # Mock timezone that raises NonExistentTimeError
            mock_tz = mock_timezone.return_value

            # Create a mock datetime object for the return value
            mock_dt = datetime.datetime(2024, 1, 1, 10, 0, 0)
            mock_utc_dt = mock_dt.replace(tzinfo=pytz.UTC)

            # Create a proper mock for the localized datetime
            from unittest.mock import MagicMock

            mock_localized_dt = MagicMock()
            mock_localized_dt.astimezone.return_value = mock_utc_dt

            # Set up side effects: first call raises exception, second call succeeds
            mock_tz.localize.side_effect = [
                pytz.NonExistentTimeError("Non-existent time"),  # First call for start
                mock_localized_dt,  # Second call for start (with adjusted time)
                pytz.NonExistentTimeError("Non-existent time"),  # First call for end
                mock_localized_dt,  # Second call for end (with adjusted time)
            ]

            start, end = parse_time_range("2024-01-01 10:00", "2024-01-01 18:00", "US/Eastern")

            # Should adjust time forward by 1 hour for nonexistent times
            assert mock_tz.localize.call_count == 4  # 2 calls per time (first fails, second succeeds)
            assert start is not None
            assert end is not None

    def test_parse_time_range_edge_cases(self):
        """Test edge cases for time parsing."""
        # Test with midnight times
        start, end = parse_time_range("2024-01-01 00:00", "2024-01-01 23:59", "UTC")
        assert start is not None
        assert end is not None
        assert start.hour == 0
        assert start.minute == 0
        assert end.hour == 23
        assert end.minute == 59

    def test_parse_time_range_different_dates(self):
        """Test parsing with different dates."""
        start, end = parse_time_range("2024-01-01 10:00", "2024-01-02 10:00", "UTC")
        assert start is not None
        assert end is not None
        assert start.date() != end.date()
        assert (end - start).days == 1

    def test_parse_time_range_seconds_handling(self):
        """Test that seconds are properly set to 0."""
        start, end = parse_time_range("2024-01-01 10:30", "2024-01-01 18:45", "UTC")
        assert start is not None
        assert end is not None
        assert start.second == 0
        assert end.second == 0

    def test_parse_time_range_timezone_conversion_accuracy(self):
        """Test accurate timezone conversion."""
        # Test with a known timezone conversion
        start, end = parse_time_range("2024-01-01 12:00", "2024-01-01 12:00", "Asia/Tokyo")

        assert start is not None
        assert end is not None
        assert start.tzinfo == pytz.UTC
        assert end.tzinfo == pytz.UTC
        # Tokyo is UTC+9, so 12:00 JST = 03:00 UTC
        assert start.hour == 3
        assert end.hour == 3

    def test_parse_time_range_summer_time(self):
        """Test parsing during summer time (DST)."""
        # Test with US/Eastern during summer (EDT = UTC-4)
        start, end = parse_time_range("2024-07-01 12:00", "2024-07-01 12:00", "US/Eastern")

        assert start is not None
        assert end is not None
        assert start.tzinfo == pytz.UTC
        assert end.tzinfo == pytz.UTC
        # 12:00 EDT = 16:00 UTC
        assert start.hour == 16
        assert end.hour == 16

    def test_parse_time_range_winter_time(self):
        """Test parsing during winter time (standard time)."""
        # Test with US/Eastern during winter (EST = UTC-5)
        start, end = parse_time_range("2024-01-01 12:00", "2024-01-01 12:00", "US/Eastern")

        assert start is not None
        assert end is not None
        assert start.tzinfo == pytz.UTC
        assert end.tzinfo == pytz.UTC
        # 12:00 EST = 17:00 UTC
        assert start.hour == 17
        assert end.hour == 17

    def test_parse_time_range_empty_strings(self):
        """Test parsing with empty strings."""
        # Empty strings are treated as None, so they should not raise errors
        start, end = parse_time_range("", "2024-01-01 18:00", "UTC")
        assert start is None
        assert end is not None

        start, end = parse_time_range("2024-01-01 10:00", "", "UTC")
        assert start is not None
        assert end is None

    def test_parse_time_range_malformed_datetime(self):
        """Test parsing with malformed datetime strings."""
        with pytest.raises(ValueError, match="time data.*does not match format"):
            parse_time_range("2024-13-01 10:00", "2024-01-01 18:00", "UTC")

        with pytest.raises(ValueError, match="time data.*does not match format"):
            parse_time_range("2024-01-01 10:00", "2024-01-32 18:00", "UTC")

    def test_parse_time_range_very_long_time_range(self):
        """Test parsing with very long time range."""
        start, end = parse_time_range("2020-01-01 00:00", "2030-12-31 23:59", "UTC")

        assert start is not None
        assert end is not None
        assert start < end
        assert (end - start).days > 3000  # More than 8 years

    def test_parse_time_range_negative_timezone(self):
        """Test parsing with negative timezone offset."""
        start, end = parse_time_range("2024-01-01 12:00", "2024-01-01 12:00", "America/New_York")

        assert start is not None
        assert end is not None
        assert start.tzinfo == pytz.UTC
        assert end.tzinfo == pytz.UTC
