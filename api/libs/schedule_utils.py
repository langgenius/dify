from datetime import UTC, datetime

import pytz
from croniter import croniter


def calculate_next_run_at(
    cron_expression: str,
    timezone: str,
    base_time: datetime | None = None,
) -> datetime:
    """
    Calculate the next run time for a cron expression in a specific timezone.

    Args:
        cron_expression: Standard 5-field cron expression or predefined expression
        timezone: Timezone string (e.g., 'UTC', 'America/New_York')
        base_time: Base time to calculate from (defaults to current UTC time)

    Returns:
        Next run time in UTC

    Note:
        Supports enhanced cron syntax including:
        - Month abbreviations: JAN, FEB, MAR-JUN, JAN,JUN,DEC
        - Day abbreviations: MON, TUE, MON-FRI, SUN,WED,FRI
        - Predefined expressions: @daily, @weekly, @monthly, @yearly, @hourly
        - Special characters: ? wildcard, L (last day), Sunday as 7
        - Standard 5-field format only (minute hour day month dayOfWeek)
    """
    # Validate cron expression format to match frontend behavior
    parts = cron_expression.strip().split()

    # Support both 5-field format and predefined expressions (matching frontend)
    if len(parts) != 5 and not cron_expression.startswith("@"):
        raise ValueError(
            f"Cron expression must have exactly 5 fields or be a predefined expression "
            f"(@daily, @weekly, etc.). Got {len(parts)} fields: '{cron_expression}'"
        )

    tz = pytz.timezone(timezone)

    if base_time is None:
        base_time = datetime.now(UTC)

    base_time_tz = base_time.astimezone(tz)
    cron = croniter(cron_expression, base_time_tz)
    next_run_tz = cron.get_next(datetime)
    next_run_utc = next_run_tz.astimezone(UTC)

    return next_run_utc


def convert_12h_to_24h(time_str: str) -> tuple[int, int]:
    """
    Parse 12-hour time format to 24-hour format for cron compatibility.

    Args:
        time_str: Time string in format "HH:MM AM/PM" (e.g., "12:30 PM")

    Returns:
        Tuple of (hour, minute) in 24-hour format

    Raises:
        ValueError: If time string format is invalid or values are out of range

    Examples:
        - "12:00 AM" -> (0, 0)    # Midnight
        - "12:00 PM" -> (12, 0)   # Noon
        - "1:30 PM"  -> (13, 30)
        - "11:59 PM" -> (23, 59)
    """
    if not time_str or not time_str.strip():
        raise ValueError("Time string cannot be empty")

    parts = time_str.strip().split()
    if len(parts) != 2:
        raise ValueError(f"Invalid time format: '{time_str}'. Expected 'HH:MM AM/PM'")

    time_part, period = parts
    period = period.upper()

    if period not in ["AM", "PM"]:
        raise ValueError(f"Invalid period: '{period}'. Must be 'AM' or 'PM'")

    time_parts = time_part.split(":")
    if len(time_parts) != 2:
        raise ValueError(f"Invalid time format: '{time_part}'. Expected 'HH:MM'")

    try:
        hour = int(time_parts[0])
        minute = int(time_parts[1])
    except ValueError as e:
        raise ValueError(f"Invalid time values: {e}")

    if hour < 1 or hour > 12:
        raise ValueError(f"Invalid hour: {hour}. Must be between 1 and 12")

    if minute < 0 or minute > 59:
        raise ValueError(f"Invalid minute: {minute}. Must be between 0 and 59")

    # Handle 12-hour to 24-hour edge cases
    if period == "PM" and hour != 12:
        hour += 12
    elif period == "AM" and hour == 12:
        hour = 0

    return hour, minute
