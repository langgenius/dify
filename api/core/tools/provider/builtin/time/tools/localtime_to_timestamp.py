from datetime import datetime
from typing import Any, Union

import pytz

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from core.tools.tool.builtin_tool import BuiltinTool


class LocaltimeToTimestampTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Convert localtime to timestamp
        """
        localtime = tool_parameters.get("localtime")
        timezone = tool_parameters.get("timezone", "Asia/Shanghai")
        if not timezone:
            timezone = None
        time_format = "%Y-%m-%d %H:%M:%S"

        timestamp = self.localtime_to_timestamp(localtime, time_format, timezone)
        if not timestamp:
            return self.create_text_message(f"Invalid localtime: {localtime}")

        return self.create_text_message(f"{timestamp}")

    @staticmethod
    def localtime_to_timestamp(localtime: str, time_format: str, local_tz=None) -> int | None:
        try:
            if local_tz is None:
                local_tz = datetime.now().astimezone().tzinfo
            if isinstance(local_tz, str):
                local_tz = pytz.timezone(local_tz)
            local_time = datetime.strptime(localtime, time_format)
            localtime = local_tz.localize(local_time)
            timestamp = int(localtime.timestamp())
            return timestamp
        except Exception as e:
            raise ToolInvokeError(str(e))
