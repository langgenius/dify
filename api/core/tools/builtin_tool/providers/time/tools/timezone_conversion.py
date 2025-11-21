from collections.abc import Generator
from datetime import datetime
from typing import Any

import pytz

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


class TimezoneConversionTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Convert time to equivalent time zone
        """
        current_time = tool_parameters.get("current_time")
        current_timezone = tool_parameters.get("current_timezone", "Asia/Shanghai")
        target_timezone = tool_parameters.get("target_timezone", "Asia/Tokyo")
        time_format = tool_parameters.get("format", "%Y-%m-%d %H:%M:%S")
        target_time = self.timezone_convert(current_time, current_timezone, target_timezone, time_format)  # type: ignore
        if not target_time:
            yield self.create_text_message(
                f"Invalid datetime and timezone: {current_time},{current_timezone},{target_timezone}"
            )
            return

        yield self.create_text_message(f"{target_time}")

    @staticmethod
    def timezone_convert(
        current_time: str, source_timezone: str, target_timezone: str, time_format: str = "%Y-%m-%d %H:%M:%S"
    ) -> str:
        """
        Convert a time string from source timezone to target timezone.
        """
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
            output_format = (
                "%Y-%m-%d %H:%M:%S" if (parsed_format is None or parsed_format == "%Y-%m-%d %H:%M") else parsed_format
            )
            return converted_datetime.strftime(output_format)
        except Exception as e:
            raise ToolInvokeError(str(e))
