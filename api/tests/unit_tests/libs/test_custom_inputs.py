"""Unit tests for custom input types."""

import pytest

from libs.custom_inputs import time_duration


class TestTimeDuration:
    """Test time_duration input validator."""

    def test_valid_days(self):
        """Test valid days format."""
        result = time_duration("7d")
        assert result == "7d"

    def test_valid_hours(self):
        """Test valid hours format."""
        result = time_duration("4h")
        assert result == "4h"

    def test_valid_minutes(self):
        """Test valid minutes format."""
        result = time_duration("30m")
        assert result == "30m"

    def test_valid_seconds(self):
        """Test valid seconds format."""
        result = time_duration("30s")
        assert result == "30s"

    def test_uppercase_conversion(self):
        """Test uppercase units are converted to lowercase."""
        result = time_duration("7D")
        assert result == "7d"

        result = time_duration("4H")
        assert result == "4h"

    def test_invalid_format_no_unit(self):
        """Test invalid format without unit."""
        with pytest.raises(ValueError, match="Invalid time duration format"):
            time_duration("7")

    def test_invalid_format_wrong_unit(self):
        """Test invalid format with wrong unit."""
        with pytest.raises(ValueError, match="Invalid time duration format"):
            time_duration("7days")

        with pytest.raises(ValueError, match="Invalid time duration format"):
            time_duration("7x")

    def test_invalid_format_no_number(self):
        """Test invalid format without number."""
        with pytest.raises(ValueError, match="Invalid time duration format"):
            time_duration("d")

        with pytest.raises(ValueError, match="Invalid time duration format"):
            time_duration("abc")

    def test_empty_string(self):
        """Test empty string."""
        with pytest.raises(ValueError, match="Time duration cannot be empty"):
            time_duration("")

    def test_none(self):
        """Test None value."""
        with pytest.raises(ValueError, match="Time duration cannot be empty"):
            time_duration(None)
