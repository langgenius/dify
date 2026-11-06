"""Pure conversion of visual trigger schedules into cron expressions."""

from core.workflow.nodes.trigger_schedule.entities import VisualConfig
from core.workflow.nodes.trigger_schedule.exc import ScheduleConfigError
from libs.schedule_utils import convert_12h_to_24h


def visual_to_cron(frequency: str, visual_config: VisualConfig) -> str:
    """
    Converts user-friendly visual schedule settings to cron expression.
    Maintains consistency with frontend UI expectations while supporting croniter's extended syntax.
    """
    if frequency == "hourly":
        if visual_config.on_minute is None:
            raise ScheduleConfigError("on_minute is required for hourly schedules")
        return f"{visual_config.on_minute} * * * *"

    elif frequency == "daily":
        if not visual_config.time:
            raise ScheduleConfigError("time is required for daily schedules")
        hour, minute = convert_12h_to_24h(visual_config.time)
        return f"{minute} {hour} * * *"

    elif frequency == "weekly":
        if not visual_config.time:
            raise ScheduleConfigError("time is required for weekly schedules")
        if not visual_config.weekdays:
            raise ScheduleConfigError("Weekdays are required for weekly schedules")
        hour, minute = convert_12h_to_24h(visual_config.time)
        weekday_map = {"sun": "0", "mon": "1", "tue": "2", "wed": "3", "thu": "4", "fri": "5", "sat": "6"}
        cron_weekdays = [weekday_map[day] for day in visual_config.weekdays]
        return f"{minute} {hour} * * {','.join(sorted(cron_weekdays))}"

    elif frequency == "monthly":
        if not visual_config.time:
            raise ScheduleConfigError("time is required for monthly schedules")
        if not visual_config.monthly_days:
            raise ScheduleConfigError("Monthly days are required for monthly schedules")
        hour, minute = convert_12h_to_24h(visual_config.time)

        numeric_days: list[int] = []
        has_last = False
        for day in visual_config.monthly_days:
            if day == "last":
                has_last = True
            else:
                numeric_days.append(day)

        result_days = [str(d) for d in sorted(set(numeric_days))]
        if has_last:
            result_days.append("L")

        return f"{minute} {hour} {','.join(result_days)} * *"

    else:
        raise ScheduleConfigError(f"Unsupported frequency: {frequency}")
