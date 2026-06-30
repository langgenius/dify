from collections.abc import Generator
from datetime import datetime, tzinfo
from typing import Any, cast, override

import pytz  # type: ignore[import-untyped]

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


class LocaltimeToTimestampTool(BuiltinTool):
    @override
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Convert localtime to timestamp
        """
        localtime = tool_parameters.get("localtime")
        timezone = tool_parameters.get("timezone", "Asia/Shanghai")
        if not timezone:
            timezone = None
        time_format = "%Y-%m-%d %H:%M:%S"

        timestamp = self.localtime_to_timestamp(localtime, time_format, timezone)  # type: ignore
        if not timestamp:
            yield self.create_text_message(f"Invalid localtime: {localtime}")
            return

        yield self.create_text_message(f"{timestamp}")

    @staticmethod
    def localtime_to_timestamp(localtime: str, time_format: str, local_tz: str | tzinfo | None = None) -> int | None:
        try:
            local_time = datetime.strptime(localtime, time_format)
            converted_localtime: datetime
            match local_tz:
                case None:
                    converted_localtime = local_time.astimezone()
                case str() as timezone_name:
                    timezone = pytz.timezone(timezone_name)
                    converted_localtime = timezone.localize(local_time)
                case tzinfo():
                    localize = getattr(local_tz, "localize", None)
                    if callable(localize):
                        converted_localtime = cast(datetime, localize(local_time))
                    else:
                        converted_localtime = local_time.replace(tzinfo=local_tz)
                case _:
                    raise ValueError("local_tz must be None, a timezone name, or a tzinfo instance")
            timestamp = int(converted_localtime.timestamp())
            return timestamp
        except Exception as e:
            raise ToolInvokeError(str(e))
