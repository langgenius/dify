from collections.abc import Generator
from datetime import UTC, datetime
from typing import Any, Optional

from pytz import timezone as pytz_timezone

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class CurrentTimeTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        invoke tools
        """
        # get timezone
        tz = tool_parameters.get("timezone", "UTC")
        fm = tool_parameters.get("format") or "%Y-%m-%d %H:%M:%S %Z"
        if tz == "UTC":
            yield self.create_text_message(f"{datetime.now(UTC).strftime(fm)}")
            return

        try:
            tz = pytz_timezone(tz)
        except Exception:
            yield self.create_text_message(f"Invalid timezone: {tz}")
            return
        yield self.create_text_message(f"{datetime.now(tz).strftime(fm)}")
