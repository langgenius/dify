"""Unit tests for time parser utility."""

from datetime import UTC, datetime, timedelta

from libs.time_parser import get_time_threshold, parse_time_duration


class TestParseTimeDuration:
    """Test parse_time_duration function."""

    def test_parse_days(self):
        """Test parsing days."""
        result = parse_time_duration("7d")
        assert result == timedelta(days=7)

    def test_parse_hours(self):
        """Test parsing hours."""
        result = parse_time_duration("4h")
        assert result == timedelta(hours=4)

    def test_parse_minutes(self):
        """Test parsing minutes."""
        result = parse_time_duration("30m")
        assert result == timedelta(minutes=30)

    def test_parse_seconds(self):
        """Test parsing seconds."""
        result = parse_time_duration("30s")
        assert result == timedelta(seconds=30)

    def test_parse_uppercase(self):
        """Test parsing uppercase units."""
        result = parse_time_duration("7D")
        assert result == timedelta(days=7)

    def test_parse_invalid_format(self):
        """Test parsing invalid format."""
        result = parse_time_duration("7days")
        assert result is None

        result = parse_time_duration("abc")
        assert result is None

        result = parse_time_duration("7")
        assert result is None

    def test_parse_empty_string(self):
        """Test parsing empty string."""
        result = parse_time_duration("")
        assert result is None

    def test_parse_none(self):
        """Test parsing None."""
        result = parse_time_duration(None)
        assert result is None


class TestGetTimeThreshold:
    """Test get_time_threshold function."""

    def test_get_threshold_days(self):
        """Test getting threshold for days."""
        before = datetime.now(UTC)
        result = get_time_threshold("7d")
        after = datetime.now(UTC)

        assert result is not None
        # Result should be approximately 7 days ago
        expected = before - timedelta(days=7)
        # Allow 1 second tolerance for test execution time
        assert abs((result - expected).total_seconds()) < 1

    def test_get_threshold_hours(self):
        """Test getting threshold for hours."""
        before = datetime.now(UTC)
        result = get_time_threshold("4h")
        after = datetime.now(UTC)

        assert result is not None
        expected = before - timedelta(hours=4)
        assert abs((result - expected).total_seconds()) < 1

    def test_get_threshold_invalid(self):
        """Test getting threshold with invalid duration."""
        result = get_time_threshold("invalid")
        assert result is None

    def test_get_threshold_none(self):
        """Test getting threshold with None."""
        result = get_time_threshold(None)
        assert result is None
