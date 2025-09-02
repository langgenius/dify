from datetime import UTC, datetime
from typing import Optional

import pytz
from croniter import croniter


def calculate_next_run_at(
    cron_expression: str,
    timezone: str,
    base_time: Optional[datetime] = None,
) -> datetime:
    """
    Calculate the next run time for a cron expression in a specific timezone.

    Args:
        cron_expression: Cron expression string (supports croniter extensions like 'L')
        timezone: Timezone string (e.g., 'UTC', 'America/New_York')
        base_time: Base time to calculate from (defaults to current UTC time)

    Returns:
        Next run time in UTC

    Note:
        Supports croniter's extended syntax including:
        - 'L' for last day of month
        - Standard 5-field cron expressions
    """

    tz = pytz.timezone(timezone)

    if base_time is None:
        base_time = datetime.now(UTC)

    base_time_tz = base_time.astimezone(tz)
    cron = croniter(cron_expression, base_time_tz)
    next_run_tz = cron.get_next(datetime)
    next_run_utc = next_run_tz.astimezone(UTC)

    return next_run_utc


def convert_12h_to_24h(time_str: str) -> tuple[Optional[int], Optional[int]]:
    """
    Parse 12-hour time format to 24-hour format for cron compatibility.

    Args:
        time_str: Time string in format "HH:MM AM/PM" (e.g., "12:30 PM")

    Returns:
        Tuple of (hour, minute) in 24-hour format, or (None, None) if parsing fails

    Examples:
        - "12:00 AM" -> (0, 0)    # Midnight
        - "12:00 PM" -> (12, 0)   # Noon
        - "1:30 PM"  -> (13, 30)
        - "11:59 PM" -> (23, 59)
    """
    try:
        parts = time_str.strip().split()
        if len(parts) != 2:
            return None, None

        time_part, period = parts
        period = period.upper()

        if period not in ["AM", "PM"]:
            return None, None

        time_parts = time_part.split(":")
        if len(time_parts) != 2:
            return None, None

        hour = int(time_parts[0])
        minute = int(time_parts[1])

        if hour < 1 or hour > 12 or minute < 0 or minute > 59:
            return None, None

        # Handle 12-hour to 24-hour edge cases
        if period == "PM" and hour != 12:
            hour += 12
        elif period == "AM" and hour == 12:
            hour = 0

        return hour, minute

    except (ValueError, AttributeError):
        return None, None
