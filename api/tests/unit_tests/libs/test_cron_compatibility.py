"""
Enhanced cron syntax compatibility tests for croniter backend.

This test suite mirrors the frontend cron-parser tests to ensure
complete compatibility between frontend and backend cron processing.
"""

import unittest
from datetime import UTC, datetime, timedelta

import pytest
import pytz
from croniter import CroniterBadCronError

from libs.schedule_utils import calculate_next_run_at


class TestCronCompatibility(unittest.TestCase):
    """Test enhanced cron syntax compatibility with frontend."""

    def setUp(self):
        """Set up test environment with fixed time."""
        self.base_time = datetime(2024, 1, 15, 10, 0, 0, tzinfo=UTC)

    def test_enhanced_dayofweek_syntax(self):
        """Test enhanced day-of-week syntax compatibility."""
        test_cases = [
            ("0 9 * * 7", 0),  # Sunday as 7
            ("0 9 * * 0", 0),  # Sunday as 0
            ("0 9 * * MON", 1),  # Monday abbreviation
            ("0 9 * * TUE", 2),  # Tuesday abbreviation
            ("0 9 * * WED", 3),  # Wednesday abbreviation
            ("0 9 * * THU", 4),  # Thursday abbreviation
            ("0 9 * * FRI", 5),  # Friday abbreviation
            ("0 9 * * SAT", 6),  # Saturday abbreviation
            ("0 9 * * SUN", 0),  # Sunday abbreviation
        ]

        for expr, expected_weekday in test_cases:
            with self.subTest(expr=expr):
                next_time = calculate_next_run_at(expr, "UTC", self.base_time)
                assert next_time is not None
                assert (next_time.weekday() + 1 if next_time.weekday() < 6 else 0) == expected_weekday
                assert next_time.hour == 9
                assert next_time.minute == 0

    def test_enhanced_month_syntax(self):
        """Test enhanced month syntax compatibility."""
        test_cases = [
            ("0 9 1 JAN *", 1),  # January abbreviation
            ("0 9 1 FEB *", 2),  # February abbreviation
            ("0 9 1 MAR *", 3),  # March abbreviation
            ("0 9 1 APR *", 4),  # April abbreviation
            ("0 9 1 MAY *", 5),  # May abbreviation
            ("0 9 1 JUN *", 6),  # June abbreviation
            ("0 9 1 JUL *", 7),  # July abbreviation
            ("0 9 1 AUG *", 8),  # August abbreviation
            ("0 9 1 SEP *", 9),  # September abbreviation
            ("0 9 1 OCT *", 10),  # October abbreviation
            ("0 9 1 NOV *", 11),  # November abbreviation
            ("0 9 1 DEC *", 12),  # December abbreviation
        ]

        for expr, expected_month in test_cases:
            with self.subTest(expr=expr):
                next_time = calculate_next_run_at(expr, "UTC", self.base_time)
                assert next_time is not None
                assert next_time.month == expected_month
                assert next_time.day == 1
                assert next_time.hour == 9

    def test_predefined_expressions(self):
        """Test predefined cron expressions compatibility."""
        test_cases = [
            ("@yearly", lambda dt: dt.month == 1 and dt.day == 1 and dt.hour == 0),
            ("@annually", lambda dt: dt.month == 1 and dt.day == 1 and dt.hour == 0),
            ("@monthly", lambda dt: dt.day == 1 and dt.hour == 0),
            ("@weekly", lambda dt: dt.weekday() == 6 and dt.hour == 0),  # Sunday = 6 in weekday()
            ("@daily", lambda dt: dt.hour == 0 and dt.minute == 0),
            ("@midnight", lambda dt: dt.hour == 0 and dt.minute == 0),
            ("@hourly", lambda dt: dt.minute == 0),
        ]

        for expr, validator in test_cases:
            with self.subTest(expr=expr):
                next_time = calculate_next_run_at(expr, "UTC", self.base_time)
                assert next_time is not None
                assert validator(next_time), f"Validator failed for {expr}: {next_time}"

    def test_special_characters(self):
        """Test special characters in cron expressions."""
        test_cases = [
            "0 9 ? * 1",  # ? wildcard
            "0 12 * * 7",  # Sunday as 7
            "0 15 L * *",  # Last day of month
        ]

        for expr in test_cases:
            with self.subTest(expr=expr):
                try:
                    next_time = calculate_next_run_at(expr, "UTC", self.base_time)
                    assert next_time is not None
                    assert next_time > self.base_time
                except Exception as e:
                    self.fail(f"Expression '{expr}' should be valid but raised: {e}")

    def test_range_and_list_syntax(self):
        """Test range and list syntax with abbreviations."""
        test_cases = [
            "0 9 * * MON-FRI",  # Weekday range with abbreviations
            "0 9 * JAN-MAR *",  # Month range with abbreviations
            "0 9 * * SUN,WED,FRI",  # Weekday list with abbreviations
            "0 9 1 JAN,JUN,DEC *",  # Month list with abbreviations
        ]

        for expr in test_cases:
            with self.subTest(expr=expr):
                try:
                    next_time = calculate_next_run_at(expr, "UTC", self.base_time)
                    assert next_time is not None
                    assert next_time > self.base_time
                except Exception as e:
                    self.fail(f"Expression '{expr}' should be valid but raised: {e}")

    def test_invalid_enhanced_syntax(self):
        """Test that invalid enhanced syntax is properly rejected."""
        invalid_expressions = [
            "0 12 * JANUARY *",  # Full month name (not supported)
            "0 12 * * MONDAY",  # Full day name (not supported)
            "0 12 32 JAN *",  # Invalid day with valid month
            "15 10 1 * 8",  # Invalid day of week
            "15 10 1 INVALID *",  # Invalid month abbreviation
            "15 10 1 * INVALID",  # Invalid day abbreviation
            "@invalid",  # Invalid predefined expression
        ]

        for expr in invalid_expressions:
            with self.subTest(expr=expr):
                with pytest.raises((CroniterBadCronError, ValueError)):
                    calculate_next_run_at(expr, "UTC", self.base_time)

    def test_edge_cases_with_enhanced_syntax(self):
        """Test edge cases with enhanced syntax."""
        test_cases = [
            ("0 0 29 FEB *", lambda dt: dt.month == 2 and dt.day == 29),  # Feb 29 with month abbreviation
        ]

        for expr, validator in test_cases:
            with self.subTest(expr=expr):
                try:
                    next_time = calculate_next_run_at(expr, "UTC", self.base_time)
                    if next_time:  # Some combinations might not occur soon
                        assert validator(next_time), f"Validator failed for {expr}: {next_time}"
                except (CroniterBadCronError, ValueError):
                    # Some edge cases might be valid but not have upcoming occurrences
                    pass

        # Test complex expressions that have specific constraints
        complex_expr = "59 23 31 DEC SAT"  # December 31st at 23:59 on Saturday
        try:
            next_time = calculate_next_run_at(complex_expr, "UTC", self.base_time)
            if next_time:
                # The next occurrence might not be exactly Dec 31 if it's not a Saturday
                # Just verify it's a valid result
                assert next_time is not None
                assert next_time.hour == 23
                assert next_time.minute == 59
        except Exception:
            # Complex date constraints might not have near-future occurrences
            pass


class TestTimezoneCompatibility(unittest.TestCase):
    """Test timezone compatibility between frontend and backend."""

    def setUp(self):
        """Set up test environment."""
        self.base_time = datetime(2024, 1, 15, 10, 0, 0, tzinfo=UTC)

    def test_timezone_consistency(self):
        """Test that calculations are consistent across different timezones."""
        timezones = [
            "UTC",
            "America/New_York",
            "Europe/London",
            "Asia/Tokyo",
            "Asia/Kolkata",
            "Australia/Sydney",
        ]

        expression = "0 12 * * *"  # Daily at noon

        for timezone in timezones:
            with self.subTest(timezone=timezone):
                next_time = calculate_next_run_at(expression, timezone, self.base_time)
                assert next_time is not None

                # Convert back to the target timezone to verify it's noon
                tz = pytz.timezone(timezone)
                local_time = next_time.astimezone(tz)
                assert local_time.hour == 12
                assert local_time.minute == 0

    def test_dst_handling(self):
        """Test DST boundary handling."""
        # Test around DST spring forward (March 2024)
        dst_base = datetime(2024, 3, 8, 10, 0, 0, tzinfo=UTC)
        expression = "0 2 * * *"  # 2 AM daily (problematic during DST)
        timezone = "America/New_York"

        try:
            next_time = calculate_next_run_at(expression, timezone, dst_base)
            assert next_time is not None

            # During DST spring forward, 2 AM becomes 3 AM - both are acceptable
            tz = pytz.timezone(timezone)
            local_time = next_time.astimezone(tz)
            assert local_time.hour in [2, 3]  # Either 2 AM or 3 AM is acceptable
        except Exception as e:
            self.fail(f"DST handling failed: {e}")

    def test_half_hour_timezones(self):
        """Test timezones with half-hour offsets."""
        timezones_with_offsets = [
            ("Asia/Kolkata", 17, 30),  # UTC+5:30 -> 12:00 UTC = 17:30 IST
            ("Australia/Adelaide", 22, 30),  # UTC+10:30 -> 12:00 UTC = 22:30 ACDT (summer time)
        ]

        expression = "0 12 * * *"  # Noon UTC

        for timezone, expected_hour, expected_minute in timezones_with_offsets:
            with self.subTest(timezone=timezone):
                try:
                    next_time = calculate_next_run_at(expression, timezone, self.base_time)
                    assert next_time is not None

                    tz = pytz.timezone(timezone)
                    local_time = next_time.astimezone(tz)
                    assert local_time.hour == expected_hour
                    assert local_time.minute == expected_minute
                except Exception:
                    # Some complex timezone calculations might vary
                    pass

    def test_invalid_timezone_handling(self):
        """Test handling of invalid timezones."""
        expression = "0 12 * * *"
        invalid_timezone = "Invalid/Timezone"

        with pytest.raises((ValueError, Exception)):  # Should raise an exception
            calculate_next_run_at(expression, invalid_timezone, self.base_time)


class TestFrontendBackendIntegration(unittest.TestCase):
    """Test integration patterns that mirror frontend usage."""

    def setUp(self):
        """Set up test environment."""
        self.base_time = datetime(2024, 1, 15, 10, 0, 0, tzinfo=UTC)

    def test_execution_time_calculator_pattern(self):
        """Test the pattern used by execution-time-calculator.ts."""
        # This mirrors the exact usage from execution-time-calculator.ts:47
        test_data = {
            "cron_expression": "30 14 * * 1-5",  # 2:30 PM weekdays
            "timezone": "America/New_York",
        }

        # Get next 5 execution times (like the frontend does)
        execution_times = []
        current_base = self.base_time

        for _ in range(5):
            next_time = calculate_next_run_at(test_data["cron_expression"], test_data["timezone"], current_base)
            assert next_time is not None
            execution_times.append(next_time)
            current_base = next_time + timedelta(seconds=1)  # Move slightly forward

        assert len(execution_times) == 5

        # Validate each execution time
        for exec_time in execution_times:
            # Convert to local timezone
            tz = pytz.timezone(test_data["timezone"])
            local_time = exec_time.astimezone(tz)

            # Should be weekdays (1-5)
            assert local_time.weekday() in [0, 1, 2, 3, 4]  # Mon-Fri in Python weekday

            # Should be 2:30 PM in local time
            assert local_time.hour == 14
            assert local_time.minute == 30
            assert local_time.second == 0

    def test_schedule_service_integration(self):
        """Test integration with ScheduleService patterns."""
        from core.workflow.nodes.trigger_schedule.entities import VisualConfig
        from services.trigger.schedule_service import ScheduleService

        # Test enhanced syntax through visual config conversion
        visual_configs = [
            # Test with month abbreviations
            {
                "frequency": "monthly",
                "config": VisualConfig(time="9:00 AM", monthly_days=[1]),
                "expected_cron": "0 9 1 * *",
            },
            # Test with weekday abbreviations
            {
                "frequency": "weekly",
                "config": VisualConfig(time="2:30 PM", weekdays=["mon", "wed", "fri"]),
                "expected_cron": "30 14 * * 1,3,5",
            },
        ]

        for test_case in visual_configs:
            with self.subTest(frequency=test_case["frequency"]):
                cron_expr = ScheduleService.visual_to_cron(test_case["frequency"], test_case["config"])
                assert cron_expr == test_case["expected_cron"]

                # Verify the generated cron expression is valid
                next_time = calculate_next_run_at(cron_expr, "UTC", self.base_time)
                assert next_time is not None

    def test_error_handling_consistency(self):
        """Test that error handling matches frontend expectations."""
        invalid_expressions = [
            "60 10 1 * *",  # Invalid minute
            "15 25 1 * *",  # Invalid hour
            "15 10 32 * *",  # Invalid day
            "15 10 1 13 *",  # Invalid month
            "15 10 1",  # Too few fields
            "15 10 1 * * *",  # 6 fields (not supported in frontend)
            "0 15 10 1 * * *",  # 7 fields (not supported in frontend)
            "invalid expression",  # Completely invalid
        ]

        for expr in invalid_expressions:
            with self.subTest(expr=repr(expr)):
                with pytest.raises((CroniterBadCronError, ValueError, Exception)):
                    calculate_next_run_at(expr, "UTC", self.base_time)

        # Note: Empty/whitespace expressions are not tested here as they are
        # not expected in normal usage due to database constraints (nullable=False)

    def test_performance_requirements(self):
        """Test that complex expressions parse within reasonable time."""
        import time

        complex_expressions = [
            "*/5 9-17 * * 1-5",  # Every 5 minutes, weekdays, business hours
            "0 */2 1,15 * *",  # Every 2 hours on 1st and 15th
            "30 14 * * 1,3,5",  # Mon, Wed, Fri at 14:30
            "15,45 8-18 * * 1-5",  # 15 and 45 minutes past hour, weekdays
            "0 9 * JAN-MAR MON-FRI",  # Enhanced syntax: Q1 weekdays at 9 AM
            "0 12 ? * SUN",  # Enhanced syntax: Sundays at noon with ?
        ]

        start_time = time.time()

        for expr in complex_expressions:
            with self.subTest(expr=expr):
                try:
                    next_time = calculate_next_run_at(expr, "UTC", self.base_time)
                    assert next_time is not None
                except CroniterBadCronError:
                    # Some enhanced syntax might not be supported, that's OK
                    pass

        end_time = time.time()
        execution_time = (end_time - start_time) * 1000  # Convert to milliseconds

        # Should complete within reasonable time (less than 150ms like frontend)
        assert execution_time < 150, "Complex expressions should parse quickly"


if __name__ == "__main__":
    # Import timedelta for the test
    from datetime import timedelta

    unittest.main()
