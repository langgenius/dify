import calendar
from datetime import datetime
from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class WeekdayTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Calculate the day of the week for a given date
        """
        year = tool_parameters.get("year")
        month = tool_parameters.get("month")
        day = tool_parameters.get("day")

        date_obj = self.convert_datetime(year, month, day)
        if not date_obj:
            return self.create_text_message(f"Invalid date: Year {year}, Month {month}, Day {day}.")

        weekday_name = calendar.day_name[date_obj.weekday()]
        month_name = calendar.month_name[month]
        readable_date = f"{month_name} {date_obj.day}, {date_obj.year}"
        return self.create_text_message(f"{readable_date} is {weekday_name}.")

    @staticmethod
    def convert_datetime(year, month, day) -> datetime | None:
        try:
            # allowed range in datetime module
            if not (year >= 1 and 1 <= month <= 12 and 1 <= day <= 31):
                return None

            year = int(year)
            month = int(month)
            day = int(day)
            return datetime(year, month, day)
        except ValueError:
            return None
