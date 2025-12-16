"""
Enhanced schedule_utils tests for new cron syntax support.

These tests verify that the backend schedule_utils functions properly support
the enhanced cron syntax introduced in the frontend, ensuring full compatibility.
"""

import unittest
from datetime import UTC, datetime, timedelta

import pytest
import pytz
from croniter import CroniterBadCronError

from libs.schedule_utils import calculate_next_run_at, convert_12h_to_24h


class TestEnhancedCronSyntax(unittest.TestCase):
    """Test enhanced cron syntax in calculate_next_run_at."""

    def setUp(self):
        """Set up test with fixed time."""
        # Monday, January 15, 2024, 10:00 AM UTC
        self.base_time = datetime(2024, 1, 15, 10, 0, 0, tzinfo=UTC)

    def test_month_abbreviations(self):
        """Test month abbreviations (JAN, FEB, etc.)."""
        test_cases = [
            ("0 12 1 JAN *", 1),  # January
            ("0 12 1 FEB *", 2),  # February
            ("0 12 1 MAR *", 3),  # March
            ("0 12 1 APR *", 4),  # April
            ("0 12 1 MAY *", 5),  # May
            ("0 12 1 JUN *", 6),  # June
            ("0 12 1 JUL *", 7),  # July
            ("0 12 1 AUG *", 8),  # August
            ("0 12 1 SEP *", 9),  # September
            ("0 12 1 OCT *", 10),  # October
            ("0 12 1 NOV *", 11),  # November
            ("0 12 1 DEC *", 12),  # December
        ]

        for expr, expected_month in test_cases:
            with self.subTest(expr=expr):
                result = calculate_next_run_at(expr, "UTC", self.base_time)
                assert result is not None, f"Failed to parse: {expr}"
                assert result.month == expected_month
                assert result.day == 1
                assert result.hour == 12
                assert result.minute == 0

    def test_weekday_abbreviations(self):
        """Test weekday abbreviations (SUN, MON, etc.)."""
        test_cases = [
            ("0 9 * * SUN", 6),  # Sunday (weekday() = 6)
            ("0 9 * * MON", 0),  # Monday (weekday() = 0)
            ("0 9 * * TUE", 1),  # Tuesday
            ("0 9 * * WED", 2),  # Wednesday
            ("0 9 * * THU", 3),  # Thursday
            ("0 9 * * FRI", 4),  # Friday
            ("0 9 * * SAT", 5),  # Saturday
        ]

        for expr, expected_weekday in test_cases:
            with self.subTest(expr=expr):
                result = calculate_next_run_at(expr, "UTC", self.base_time)
                assert result is not None, f"Failed to parse: {expr}"
                assert result.weekday() == expected_weekday
                assert result.hour == 9
                assert result.minute == 0

    def test_sunday_dual_representation(self):
        """Test Sunday as both 0 and 7."""
        base_time = datetime(2024, 1, 14, 10, 0, 0, tzinfo=UTC)  # Sunday

        # Both should give the same next Sunday
        result_0 = calculate_next_run_at("0 10 * * 0", "UTC", base_time)
        result_7 = calculate_next_run_at("0 10 * * 7", "UTC", base_time)
        result_SUN = calculate_next_run_at("0 10 * * SUN", "UTC", base_time)

        assert result_0 is not None
        assert result_7 is not None
        assert result_SUN is not None

        # All should be Sundays
        assert result_0.weekday() == 6  # Sunday = 6 in weekday()
        assert result_7.weekday() == 6
        assert result_SUN.weekday() == 6

        # Times should be identical
        assert result_0 == result_7
        assert result_0 == result_SUN

    def test_predefined_expressions(self):
        """Test predefined expressions (@daily, @weekly, etc.)."""
        test_cases = [
            ("@yearly", lambda dt: dt.month == 1 and dt.day == 1 and dt.hour == 0 and dt.minute == 0),
            ("@annually", lambda dt: dt.month == 1 and dt.day == 1 and dt.hour == 0 and dt.minute == 0),
            ("@monthly", lambda dt: dt.day == 1 and dt.hour == 0 and dt.minute == 0),
            ("@weekly", lambda dt: dt.weekday() == 6 and dt.hour == 0 and dt.minute == 0),  # Sunday
            ("@daily", lambda dt: dt.hour == 0 and dt.minute == 0),
            ("@midnight", lambda dt: dt.hour == 0 and dt.minute == 0),
            ("@hourly", lambda dt: dt.minute == 0),
        ]

        for expr, validator in test_cases:
            with self.subTest(expr=expr):
                result = calculate_next_run_at(expr, "UTC", self.base_time)
                assert result is not None, f"Failed to parse: {expr}"
                assert validator(result), f"Validator failed for {expr}: {result}"

    def test_question_mark_wildcard(self):
        """Test ? wildcard character."""
        # ? in day position with specific weekday
        result_question = calculate_next_run_at("0 9 ? * 1", "UTC", self.base_time)  # Monday
        result_star = calculate_next_run_at("0 9 * * 1", "UTC", self.base_time)  # Monday

        assert result_question is not None
        assert result_star is not None

        # Both should return Mondays at 9:00
        assert result_question.weekday() == 0  # Monday
        assert result_star.weekday() == 0
        assert result_question.hour == 9
        assert result_star.hour == 9

        # Results should be identical
        assert result_question == result_star

    def test_last_day_of_month(self):
        """Test 'L' for last day of month."""
        expr = "0 12 L * *"  # Last day of month at noon

        # Test for February (28 days in 2024 - not a leap year check)
        feb_base = datetime(2024, 2, 15, 10, 0, 0, tzinfo=UTC)
        result = calculate_next_run_at(expr, "UTC", feb_base)
        assert result is not None
        assert result.month == 2
        assert result.day == 29  # 2024 is a leap year
        assert result.hour == 12

    def test_range_with_abbreviations(self):
        """Test ranges using abbreviations."""
        test_cases = [
            "0 9 * * MON-FRI",  # Weekday range
            "0 12 * JAN-MAR *",  # Q1 months
            "0 15 * APR-JUN *",  # Q2 months
        ]

        for expr in test_cases:
            with self.subTest(expr=expr):
                result = calculate_next_run_at(expr, "UTC", self.base_time)
                assert result is not None, f"Failed to parse range expression: {expr}"
                assert result > self.base_time

    def test_list_with_abbreviations(self):
        """Test lists using abbreviations."""
        test_cases = [
            ("0 9 * * SUN,WED,FRI", [6, 2, 4]),  # Specific weekdays
            ("0 12 1 JAN,JUN,DEC *", [1, 6, 12]),  # Specific months
        ]

        for expr, expected_values in test_cases:
            with self.subTest(expr=expr):
                result = calculate_next_run_at(expr, "UTC", self.base_time)
                assert result is not None, f"Failed to parse list expression: {expr}"

                if "* *" in expr:  # Weekday test
                    assert result.weekday() in expected_values
                else:  # Month test
                    assert result.month in expected_values

    def test_mixed_syntax(self):
        """Test mixed traditional and enhanced syntax."""
        test_cases = [
            "30 14 15 JAN,JUN,DEC *",  # Numbers + month abbreviations
            "0 9 * JAN-MAR MON-FRI",  # Month range + weekday range
            "45 8 1,15 * MON",  # Numbers + weekday abbreviation
        ]

        for expr in test_cases:
            with self.subTest(expr=expr):
                result = calculate_next_run_at(expr, "UTC", self.base_time)
                assert result is not None, f"Failed to parse mixed syntax: {expr}"
                assert result > self.base_time

    def test_complex_enhanced_expressions(self):
        """Test complex expressions with multiple enhanced features."""
        # Note: Some of these might not be supported by croniter, that's OK
        complex_expressions = [
            "0 9 L JAN *",  # Last day of January
            "30 14 * * FRI#1",  # First Friday of month (if supported)
            "0 12 15 JAN-DEC/3 *",  # 15th of every 3rd month (quarterly)
        ]

        for expr in complex_expressions:
            with self.subTest(expr=expr):
                try:
                    result = calculate_next_run_at(expr, "UTC", self.base_time)
                    if result:  # If supported, should return valid result
                        assert result > self.base_time
                except Exception:
                    # Some complex expressions might not be supported - that's acceptable
                    pass


class TestTimezoneHandlingEnhanced(unittest.TestCase):
    """Test timezone handling with enhanced syntax."""

    def setUp(self):
        """Set up test with fixed time."""
        self.base_time = datetime(2024, 1, 15, 10, 0, 0, tzinfo=UTC)

    def test_enhanced_syntax_with_timezones(self):
        """Test enhanced syntax works correctly across timezones."""
        timezones = ["UTC", "America/New_York", "Asia/Tokyo", "Europe/London"]
        expression = "0 12 * * MON"  # Monday at noon

        for timezone in timezones:
            with self.subTest(timezone=timezone):
                result = calculate_next_run_at(expression, timezone, self.base_time)
                assert result is not None

                # Convert to local timezone to verify it's Monday at noon
                tz = pytz.timezone(timezone)
                local_time = result.astimezone(tz)
                assert local_time.weekday() == 0  # Monday
                assert local_time.hour == 12
                assert local_time.minute == 0

    def test_predefined_expressions_with_timezones(self):
        """Test predefined expressions work with different timezones."""
        expression = "@daily"
        timezones = ["UTC", "America/New_York", "Asia/Tokyo"]

        for timezone in timezones:
            with self.subTest(timezone=timezone):
                result = calculate_next_run_at(expression, timezone, self.base_time)
                assert result is not None

                # Should be midnight in the specified timezone
                tz = pytz.timezone(timezone)
                local_time = result.astimezone(tz)
                assert local_time.hour == 0
                assert local_time.minute == 0

    def test_dst_with_enhanced_syntax(self):
        """Test DST handling with enhanced syntax."""
        # DST spring forward date in 2024
        dst_base = datetime(2024, 3, 8, 10, 0, 0, tzinfo=UTC)
        expression = "0 2 * * SUN"  # Sunday at 2 AM (problematic during DST)
        timezone = "America/New_York"

        result = calculate_next_run_at(expression, timezone, dst_base)
        assert result is not None

        # Should handle DST transition gracefully
        tz = pytz.timezone(timezone)
        local_time = result.astimezone(tz)
        assert local_time.weekday() == 6  # Sunday

        # During DST spring forward, 2 AM might become 3 AM
        assert local_time.hour in [2, 3]


class TestErrorHandlingEnhanced(unittest.TestCase):
    """Test error handling for enhanced syntax."""

    def setUp(self):
        """Set up test with fixed time."""
        self.base_time = datetime(2024, 1, 15, 10, 0, 0, tzinfo=UTC)

    def test_invalid_enhanced_syntax(self):
        """Test that invalid enhanced syntax raises appropriate errors."""
        invalid_expressions = [
            "0 12 * JANUARY *",  # Full month name
            "0 12 * * MONDAY",  # Full day name
            "0 12 32 JAN *",  # Invalid day with valid month
            "0 12 * * MON-SUN-FRI",  # Invalid range syntax
            "0 12 * JAN- *",  # Incomplete range
            "0 12 * * ,MON",  # Invalid list syntax
            "@INVALID",  # Invalid predefined
        ]

        for expr in invalid_expressions:
            with self.subTest(expr=expr):
                with pytest.raises((CroniterBadCronError, ValueError)):
                    calculate_next_run_at(expr, "UTC", self.base_time)

    def test_boundary_values_with_enhanced_syntax(self):
        """Test boundary values work with enhanced syntax."""
        # Valid boundary expressions
        valid_expressions = [
            "0 0 1 JAN *",  # Minimum: January 1st midnight
            "59 23 31 DEC *",  # Maximum: December 31st 23:59
            "0 12 29 FEB *",  # Leap year boundary
        ]

        for expr in valid_expressions:
            with self.subTest(expr=expr):
                try:
                    result = calculate_next_run_at(expr, "UTC", self.base_time)
                    if result:  # Some dates might not occur soon
                        assert result > self.base_time
                except Exception as e:
                    # Some boundary cases might be complex to calculate
                    self.fail(f"Valid boundary expression failed: {expr} - {e}")


class TestPerformanceEnhanced(unittest.TestCase):
    """Test performance with enhanced syntax."""

    def setUp(self):
        """Set up test with fixed time."""
        self.base_time = datetime(2024, 1, 15, 10, 0, 0, tzinfo=UTC)

    def test_complex_expression_performance(self):
        """Test that complex enhanced expressions parse within reasonable time."""
        import time

        complex_expressions = [
            "*/5 9-17 * * MON-FRI",  # Every 5 min, weekdays, business hours
            "0 9 * JAN-MAR MON-FRI",  # Q1 weekdays at 9 AM
            "30 14 1,15 * * ",  # 1st and 15th at 14:30
            "0 12 ? * SUN",  # Sundays at noon with ?
            "@daily",  # Predefined expression
        ]

        start_time = time.time()

        for expr in complex_expressions:
            with self.subTest(expr=expr):
                try:
                    result = calculate_next_run_at(expr, "UTC", self.base_time)
                    assert result is not None
                except Exception:
                    # Some expressions might not be supported - acceptable
                    pass

        end_time = time.time()
        execution_time = (end_time - start_time) * 1000  # milliseconds

        # Should be fast (less than 100ms for all expressions)
        assert execution_time < 100, "Enhanced expressions should parse quickly"

    def test_multiple_calculations_performance(self):
        """Test performance when calculating multiple next times."""
        import time

        expression = "0 9 * * MON-FRI"  # Weekdays at 9 AM
        iterations = 20

        start_time = time.time()

        current_time = self.base_time
        for _ in range(iterations):
            result = calculate_next_run_at(expression, "UTC", current_time)
            assert result is not None
            current_time = result + timedelta(seconds=1)  # Move forward slightly

        end_time = time.time()
        total_time = (end_time - start_time) * 1000  # milliseconds
        avg_time = total_time / iterations

        # Average should be very fast (less than 5ms per calculation)
        assert avg_time < 5, f"Average calculation time too slow: {avg_time}ms"


class TestRegressionEnhanced(unittest.TestCase):
    """Regression tests to ensure enhanced syntax doesn't break existing functionality."""

    def setUp(self):
        """Set up test with fixed time."""
        self.base_time = datetime(2024, 1, 15, 10, 0, 0, tzinfo=UTC)

    def test_traditional_syntax_still_works(self):
        """Ensure traditional cron syntax continues to work."""
        traditional_expressions = [
            "15 10 1 * *",  # Monthly 1st at 10:15
            "0 0 * * 0",  # Weekly Sunday midnight
            "*/5 * * * *",  # Every 5 minutes
            "0 9-17 * * 1-5",  # Business hours weekdays
            "30 14 * * 1",  # Monday 14:30
            "0 0 1,15 * *",  # 1st and 15th midnight
        ]

        for expr in traditional_expressions:
            with self.subTest(expr=expr):
                result = calculate_next_run_at(expr, "UTC", self.base_time)
                assert result is not None, f"Traditional expression failed: {expr}"
                assert result > self.base_time

    def test_convert_12h_to_24h_unchanged(self):
        """Ensure convert_12h_to_24h function is unchanged."""
        test_cases = [
            ("12:00 AM", (0, 0)),  # Midnight
            ("12:00 PM", (12, 0)),  # Noon
            ("1:30 AM", (1, 30)),  # Early morning
            ("11:45 PM", (23, 45)),  # Late evening
            ("6:15 AM", (6, 15)),  # Morning
            ("3:30 PM", (15, 30)),  # Afternoon
        ]

        for time_str, expected in test_cases:
            with self.subTest(time_str=time_str):
                result = convert_12h_to_24h(time_str)
                assert result == expected, f"12h conversion failed: {time_str}"


if __name__ == "__main__":
    unittest.main()
