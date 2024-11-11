from datetime import datetime
from typing import Any, Union

import pytz

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from core.tools.tool.builtin_tool import BuiltinTool


class TimezoneConversionTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Convert time to equivalent time zone
        """
        current_time = tool_parameters.get("current_time")
        current_timezone = tool_parameters.get("current_timezone", "Asia/Shanghai")
        target_timezone = tool_parameters.get("target_timezone", "Asia/Tokyo")
        target_time = self.timezone_convert(current_time, current_timezone, target_timezone)
        if not target_time:
            return self.create_text_message(
                f"Invalid datatime and timezone: {current_time},{current_timezone},{target_timezone}"
            )

        return self.create_text_message(f"{target_time}")

    @staticmethod
    def timezone_convert(current_time: str, source_timezone: str, target_timezone: str) -> str:
        """
        Convert a time string from source timezone to target timezone.
        """
        time_format = "%Y-%m-%d %H:%M:%S"
        try:
            # get source timezone
            input_timezone = pytz.timezone(source_timezone)
            # get target timezone
            output_timezone = pytz.timezone(target_timezone)
            local_time = datetime.strptime(current_time, time_format)
            datetime_with_tz = input_timezone.localize(local_time)
            # timezone convert
            converted_datetime = datetime_with_tz.astimezone(output_timezone)
            return converted_datetime.strftime(format=time_format)
        except Exception as e:
            raise ToolInvokeError(str(e))
