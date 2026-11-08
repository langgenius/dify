from collections.abc import Generator
from datetime import datetime
from typing import Any, override
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


def _attach_tz(wall: datetime, tz: ZoneInfo) -> datetime:
    """Attach ``tz`` to a naive wall-clock time, keeping ``pytz.localize`` defaults.

    ``pytz`` uses ``is_dst=False`` by default: an ambiguous fall-back time maps to the
    second (standard-time) occurrence, and a spring-forward gap keeps the pre-transition
    offset. ``replace(tzinfo=...)`` alone always selects ``fold=0``, which shifts
    ambiguous times by one hour.
    """
    first = wall.replace(tzinfo=tz, fold=0)
    second = wall.replace(tzinfo=tz, fold=1)
    offset_first = first.utcoffset()
    offset_second = second.utcoffset()
    if offset_first is None or offset_second is None or offset_first == offset_second:
        return first
    # Ambiguous: keep the standard-time occurrence, matching is_dst=False.
    # Nonexistent (gap): fold=0 already applies the pre-transition offset.
    return second if offset_first > offset_second else first


class TimezoneConversionTool(BuiltinTool):
    @override
    def _invoke(
        self,
        session: Session,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage]:
        """
        Convert time to equivalent time zone
        """
        current_time = tool_parameters.get("current_time")
        current_timezone = tool_parameters.get("current_timezone", "Asia/Shanghai")
        target_timezone = tool_parameters.get("target_timezone", "Asia/Tokyo")
        target_time = self.timezone_convert(current_time, current_timezone, target_timezone)  # type: ignore
        if not target_time:
            yield self.create_text_message(
                f"Invalid datetime and timezone: {current_time},{current_timezone},{target_timezone}"
            )
            return

        yield self.create_text_message(f"{target_time}")

    @staticmethod
    def timezone_convert(current_time: str, source_timezone: str, target_timezone: str) -> str:
        """
        Convert a time string from source timezone to target timezone.
        """
        time_format = "%Y-%m-%d %H:%M:%S"
        try:
            # get source timezone
            input_timezone = ZoneInfo(source_timezone)
            # get target timezone
            output_timezone = ZoneInfo(target_timezone)
            local_time = datetime.strptime(current_time, time_format)
            datetime_with_tz = _attach_tz(local_time, input_timezone)
            # timezone convert
            converted_datetime = datetime_with_tz.astimezone(output_timezone)
            return converted_datetime.strftime(time_format)
        except Exception as e:
            raise ToolInvokeError(str(e)) from e
