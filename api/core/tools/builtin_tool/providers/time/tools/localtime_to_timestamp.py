from collections.abc import Generator
from datetime import datetime
from typing import Any

import pytz

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


class LocaltimeToTimestampTool(BuiltinTool):
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

    # TODO: this method's type is messy
    @staticmethod
    def localtime_to_timestamp(localtime: str, time_format: str, local_tz=None) -> int | None:
        try:
            local_time = datetime.strptime(localtime, time_format)
            if local_tz is None:
                localtime = local_time.astimezone()  # type: ignore
            elif isinstance(local_tz, str):
                local_tz = pytz.timezone(local_tz)
                localtime = local_tz.localize(local_time)  # type: ignore
            timestamp = int(localtime.timestamp())  # type: ignore
            return timestamp
        except Exception as e:
            raise ToolInvokeError(str(e))
