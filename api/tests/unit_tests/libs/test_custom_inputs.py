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

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param("1000000000d", id="timedelta-days-overflow"),
            pytest.param("86400000000000s", id="timedelta-seconds-overflow"),
            pytest.param("1000000d", id="datetime-underflow"),
            pytest.param("9" * 4301 + "s", id="integer-digit-limit"),
        ],
    )
    def test_rejects_unrepresentable_time_range(self, value: str):
        """A syntactically valid duration must also produce a valid threshold."""
        with pytest.raises(ValueError, match="Time duration is out of supported range"):
            time_duration(value)

    @pytest.mark.parametrize("value", ["0s", "365000d", "8760000H"])
    def test_accepts_representable_time_range(self, value: str):
        """Zero and large valid durations retain the normalised string format."""
        assert time_duration(value) == value.lower()
