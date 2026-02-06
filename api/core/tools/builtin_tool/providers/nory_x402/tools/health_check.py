from collections.abc import Generator
from typing import Any

import requests

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError

NORY_API_BASE = "https://noryx402.com"


class HealthCheckTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Check Nory service health.
        """
        try:
            response = requests.get(
                f"{NORY_API_BASE}/api/x402/health",
                timeout=30,
            )
            response.raise_for_status()

            yield self.create_text_message(response.text)
        except Exception as e:
            raise ToolInvokeError(str(e))
