"""Unit tests for time parser utility."""

from datetime import UTC, datetime, timedelta

from libs.time_parser import get_time_threshold, parse_time_duration


class TestParseTimeDuration:
    """Test parse_time_duration function."""

    def test_parse_days(self) -> None:
        """Test parsing days."""
        result = parse_time_duration("7d")
        assert result == timedelta(days=7)

    def test_parse_hours(self) -> None:
        """Test parsing hours."""
        result = parse_time_duration("4h")
        assert result == timedelta(hours=4)

    def test_parse_minutes(self) -> None:
        """Test parsing minutes."""
        result = parse_time_duration("30m")
        assert result == timedelta(minutes=30)

    def test_parse_seconds(self) -> None:
        """Test parsing seconds."""
        result = parse_time_duration("30s")
        assert result == timedelta(seconds=30)

    def test_parse_uppercase(self) -> None:
        """Test parsing uppercase units."""
        result = parse_time_duration("7D")
        assert result == timedelta(days=7)

    def test_parse_invalid_format(self) -> None:
        """Test parsing invalid format."""
        result = parse_time_duration("7days")
        assert result is None

        result = parse_time_duration("abc")
        assert result is None

        result = parse_time_duration("7")
        assert result is None

    def test_parse_empty_string(self) -> None:
        """Test parsing empty string."""
        result = parse_time_duration("")
        assert result is None

    def test_parse_none(self) -> None:
        """Test parsing None."""
        result = parse_time_duration(None)  # pyrefly: ignore[bad-argument-type]
        assert result is None


class TestGetTimeThreshold:
    """Test get_time_threshold function."""

    def test_get_threshold_days(self) -> None:
        """Test getting threshold for days."""
        before = datetime.now(UTC)
        result = get_time_threshold("7d")

        assert result is not None
        # Result should be approximately 7 days ago
        expected = before - timedelta(days=7)
        # Allow 1 second tolerance for test execution time
        assert abs((result - expected).total_seconds()) < 1

    def test_get_threshold_hours(self) -> None:
        """Test getting threshold for hours."""
        before = datetime.now(UTC)
        result = get_time_threshold("4h")

        assert result is not None
        expected = before - timedelta(hours=4)
        assert abs((result - expected).total_seconds()) < 1

    def test_get_threshold_invalid(self) -> None:
        """Test getting threshold with invalid duration."""
        result = get_time_threshold("invalid")
        assert result is None

    def test_get_threshold_none(self) -> None:
        """Test getting threshold with None."""
        result = get_time_threshold(None)
        assert result is None
