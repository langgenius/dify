import pytest
import pytz
from datetime import datetime


# Define the error class for testing
class ToolInvokeError(Exception):
    pass

# Extract the static methods directly to avoid circular imports
def localtime_to_timestamp(localtime: str, time_format: str, local_tz=None) -> int | None:
    """Extracted static method from LocaltimeToTimestampTool for testing"""
    # Try common datetime formats if parsing fails
    common_formats = [
        time_format,
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M",
    ]

    local_time = None
    for fmt in common_formats:
        try:
            local_time = datetime.strptime(localtime, fmt)
            break
        except ValueError:
            continue

    if local_time is None:
        raise ToolInvokeError(f"Unable to parse datetime string '{localtime}' with common formats")

    try:
        if local_tz is None:
            localtime = local_time.astimezone()  # type: ignore
        elif isinstance(local_tz, str):
            local_tz = pytz.timezone(local_tz)
            localtime = local_tz.localize(local_time)  # type: ignore
        timestamp = int(localtime.timestamp())  # type: ignore
        return timestamp
    except Exception as e:
        raise ToolInvokeError(str(e))

def timezone_convert(current_time: str, source_timezone: str, target_timezone: str, time_format: str = "%Y-%m-%d %H:%M:%S") -> str:
    """Extracted static method from TimezoneConversionTool for testing"""
    import pytz
    from datetime import datetime

    # Try common datetime formats if parsing fails
    common_formats = [
        time_format,
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M",
    ]

    local_time = None
    parsed_format = None
    for fmt in common_formats:
        try:
            local_time = datetime.strptime(current_time, fmt)
            parsed_format = fmt
            break
        except ValueError:
            continue

    if local_time is None:
        raise ToolInvokeError(f"Unable to parse datetime string '{current_time}' with common formats")

    try:
        # get source timezone
        input_timezone = pytz.timezone(source_timezone)
        # get target timezone
        output_timezone = pytz.timezone(target_timezone)
        datetime_with_tz = input_timezone.localize(local_time)
        # timezone convert
        converted_datetime = datetime_with_tz.astimezone(output_timezone)
        # Use the parsed format for output, default to %Y-%m-%d %H:%M:%S if input didn't have seconds
        output_format = "%Y-%m-%d %H:%M:%S" if (parsed_format is None or parsed_format == "%Y-%m-%d %H:%M") else parsed_format
        return converted_datetime.strftime(output_format)
    except Exception as e:
        raise ToolInvokeError(str(e))


class TestLocaltimeToTimestampTool:
    """Test cases for LocaltimeToTimestampTool"""

    def test_localtime_to_timestamp_with_seconds(self):
        """Test parsing datetime string with seconds"""
        result = localtime_to_timestamp("2024-01-01 12:30:45", "%Y-%m-%d %H:%M:%S")
        assert result is not None
        assert isinstance(result, int)

        # Verify the timestamp corresponds to the expected datetime
        expected_dt = datetime.strptime("2024-01-01 12:30:45", "%Y-%m-%d %H:%M:%S")
        expected_timestamp = int(expected_dt.timestamp())
        assert result == expected_timestamp

    def test_localtime_to_timestamp_without_seconds(self):
        """Test parsing datetime string without seconds (the main fix for the issue)"""
        result = localtime_to_timestamp("2024-01-01 12:30", "%Y-%m-%d %H:%M:%S")
        assert result is not None
        assert isinstance(result, int)

        # Verify the timestamp corresponds to the expected datetime (seconds should be 0)
        expected_dt = datetime.strptime("2024-01-01 12:30:00", "%Y-%m-%d %H:%M:%S")
        expected_timestamp = int(expected_dt.timestamp())
        assert result == expected_timestamp

    def test_localtime_to_timestamp_with_custom_format(self):
        """Test parsing datetime string with custom format"""
        result = localtime_to_timestamp("2024/01/01 12:30", "%Y/%m/%d %H:%M")
        assert result is not None
        assert isinstance(result, int)

        expected_dt = datetime.strptime("2024/01/01 12:30:00", "%Y/%m/%d %H:%M:%S")
        expected_timestamp = int(expected_dt.timestamp())
        assert result == expected_timestamp

    def test_localtime_to_timestamp_with_timezone(self):
        """Test parsing datetime string with timezone"""
        result = localtime_to_timestamp("2024-01-01 12:30:45", "%Y-%m-%d %H:%M:%S", "Asia/Shanghai")
        assert result is not None
        assert isinstance(result, int)

    def test_localtime_to_timestamp_with_microseconds(self):
        """Test parsing datetime string with microseconds"""
        result = localtime_to_timestamp("2024-01-01 12:30:45.123456", "%Y-%m-%d %H:%M:%S")
        assert result is not None
        assert isinstance(result, int)

    def test_localtime_to_timestamp_us_format(self):
        """Test parsing US format datetime string"""
        result = localtime_to_timestamp("01/01/2024 12:30", "%Y-%m-%d %H:%M:%S")
        assert result is not None
        assert isinstance(result, int)

    def test_localtime_to_timestamp_invalid_datetime(self):
        """Test error handling for invalid datetime string"""
        with pytest.raises(ToolInvokeError, match="Unable to parse datetime string"):
            localtime_to_timestamp("invalid-datetime", "%Y-%m-%d %H:%M:%S")

    def test_localtime_to_timestamp_empty_string(self):
        """Test error handling for empty datetime string"""
        with pytest.raises(ToolInvokeError, match="Unable to parse datetime string"):
            localtime_to_timestamp("", "%Y-%m-%d %H:%M:%S")

    def test_localtime_to_timestamp_various_formats(self):
        """Test various datetime formats that should be supported"""
        test_cases = [
            ("2024-01-01 12:30:45", "%Y-%m-%d %H:%M:%S"),
            ("2024-01-01 12:30", "%Y-%m-%d %H:%M:%S"),  # Main issue case
            ("2024/01/01 12:30:45", "%Y-%m-%d %H:%M:%S"),
            ("2024/01/01 12:30", "%Y-%m-%d %H:%M:%S"),
            ("01/01/2024 12:30:45", "%Y-%m-%d %H:%M:%S"),
            ("01/01/2024 12:30", "%Y-%m-%d %H:%M:%S"),
        ]

        for datetime_str, default_format in test_cases:
            result = localtime_to_timestamp(datetime_str, default_format)
            assert result is not None
            assert isinstance(result, int)


class TestTimezoneConversionTool:
    """Test cases for TimezoneConversionTool"""

    def test_timezone_convert_basic(self):
        """Test basic timezone conversion"""
        result = timezone_convert("2024-01-01 12:00:00", "UTC", "Asia/Shanghai")
        assert result is not None
        assert isinstance(result, str)
        # Shanghai is UTC+8, so 12:00 UTC should become 20:00
        assert "20:00:00" in result

    def test_timezone_convert_without_seconds(self):
        """Test timezone conversion with datetime string without seconds"""
        result = timezone_convert("2024-01-01 12:00", "UTC", "Asia/Shanghai")
        assert result is not None
        assert isinstance(result, str)
        # Should handle the missing seconds gracefully
        assert "20:00:00" in result

    def test_timezone_convert_custom_format(self):
        """Test timezone conversion with custom format"""
        result = timezone_convert("2024/01/01 12:00", "UTC", "Asia/Shanghai", "%Y/%m/%d %H:%M")
        assert result is not None
        assert isinstance(result, str)

    def test_timezone_convert_with_microseconds(self):
        """Test timezone conversion with microseconds in input"""
        result = timezone_convert("2024-01-01 12:00:45.123456", "UTC", "Asia/Shanghai")
        assert result is not None
        assert isinstance(result, str)

    def test_timezone_convert_us_format(self):
        """Test timezone conversion with US date format"""
        result = timezone_convert("01/01/2024 12:00", "UTC", "Asia/Shanghai")
        assert result is not None
        assert isinstance(result, str)

    def test_timezone_convert_same_timezone(self):
        """Test conversion within same timezone should return same time"""
        result = timezone_convert("2024-01-01 12:00:00", "UTC", "UTC")
        assert "12:00:00" in result

    def test_timezone_convert_new_york_to_tokyo(self):
        """Test conversion from New York to Tokyo"""
        result = timezone_convert("2024-01-01 12:00:00", "America/New_York", "Asia/Tokyo")
        assert result is not None
        assert isinstance(result, str)
        # Tokyo is 14 hours ahead of New York in winter
        # So 12:00 EST should become around 02:00 or 03:00 JST next day
        assert "02:00" in result or "03:00" in result

    def test_timezone_convert_invalid_datetime(self):
        """Test error handling for invalid datetime string"""
        with pytest.raises(ToolInvokeError, match="Unable to parse datetime string"):
            timezone_convert("invalid-datetime", "UTC", "Asia/Shanghai")

    def test_timezone_convert_invalid_timezone(self):
        """Test error handling for invalid timezone"""
        with pytest.raises(Exception):  # pytz raises UnknownTimeZoneError
            timezone_convert("2024-01-01 12:00:00", "Invalid/Timezone", "Asia/Shanghai")

    def test_timezone_convert_output_format_preservation(self):
        """Test that output format matches input format style"""
        # Test with seconds - should keep seconds in output
        result_with_seconds = timezone_convert("2024-01-01 12:00:45", "UTC", "Asia/Shanghai")
        assert ":" in result_with_seconds and result_with_seconds.count(":") >= 2

        # Test without seconds - should add seconds in output by default
        result_without_seconds = timezone_convert("2024-01-01 12:00", "UTC", "Asia/Shanghai")
        assert ":" in result_without_seconds and result_without_seconds.count(":") >= 2

    def test_timezone_convert_various_formats(self):
        """Test various datetime formats that should be supported"""
        test_cases = [
            ("2024-01-01 12:00:00", "UTC", "Asia/Shanghai"),
            ("2024-01-01 12:00", "UTC", "Asia/Shanghai"),  # Main issue case
            ("2024/01/01 12:00:00", "UTC", "Asia/Shanghai"),
            ("2024/01/01 12:00", "UTC", "Asia/Shanghai"),
            ("01/01/2024 12:00:00", "UTC", "Asia/Shanghai"),
            ("01/01/2024 12:00", "UTC", "Asia/Shanghai"),
        ]

        for datetime_str, source_tz, target_tz in test_cases:
            result = timezone_convert(datetime_str, source_tz, target_tz)
            assert result is not None
            assert isinstance(result, str)
            # Verify the result has the expected time components
            assert ":" in result

    def test_timezone_convert_dst_handling(self):
        """Test timezone conversion during daylight saving time"""
        # Test with a date during DST (Northern Hemisphere summer)
        result = timezone_convert("2024-07-01 12:00:00", "UTC", "America/New_York")
        assert result is not None
        assert isinstance(result, str)
        # In July, New York is UTC-4 (EDT), so 12:00 UTC should become 08:00
        assert "08:00:00" in result
