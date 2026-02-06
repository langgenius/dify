from collections.abc import Generator
from typing import Any

import requests

from core.tools.builtin_tool.providers.nory_x402.nory_x402 import NORY_API_BASE
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


class SettlePaymentTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Settle a payment on-chain.
        """
        try:
            payload = tool_parameters.get("payload", "")

            if not payload:
                yield self.create_text_message("Please provide a payment payload")
                return

            headers = {"Content-Type": "application/json"}
            api_key = self.runtime.credentials.get("api_key")
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"

            response = requests.post(
                f"{NORY_API_BASE}/api/x402/settle",
                json={"payload": payload},
                headers=headers,
                timeout=30,
            )
            response.raise_for_status()

            yield self.create_text_message(response.text)
        except requests.exceptions.RequestException as e:
            raise ToolInvokeError(f"Request failed: {e}")
