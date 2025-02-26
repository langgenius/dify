from collections.abc import Generator
from datetime import datetime
from typing import Any, Optional

import pytz

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


class TimestampToLocaltimeTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Convert timestamp to localtime
        """
        timestamp: int = tool_parameters.get("timestamp", 0)
        timezone = tool_parameters.get("timezone", "Asia/Shanghai")
        if not timezone:
            timezone = None
        time_format = "%Y-%m-%d %H:%M:%S"

        locatime = self.timestamp_to_localtime(timestamp, timezone)
        if not locatime:
            yield self.create_text_message(f"Invalid timestamp: {timestamp}")
            return

        localtime_format = locatime.strftime(time_format)

        yield self.create_text_message(f"{localtime_format}")

    @staticmethod
    def timestamp_to_localtime(timestamp: int, local_tz=None) -> datetime | None:
        try:
            if local_tz is None:
                local_tz = datetime.now().astimezone().tzinfo
            if isinstance(local_tz, str):
                local_tz = pytz.timezone(local_tz)
            local_time = datetime.fromtimestamp(timestamp, local_tz)
            return local_time
        except Exception as e:
            raise ToolInvokeError(str(e))
