from collections.abc import Generator
from typing import Any

import requests

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError

NORY_API_BASE = "https://noryx402.com"


class LookupTransactionTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Look up transaction status.
        """
        try:
            transaction_id = tool_parameters.get("transaction_id", "")
            network = tool_parameters.get("network", "")

            if not transaction_id:
                yield self.create_text_message("Please provide a transaction ID")
                return

            if not network:
                yield self.create_text_message("Please provide a network")
                return

            headers = {}
            api_key = self.runtime.credentials.get("api_key")
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"

            response = requests.get(
                f"{NORY_API_BASE}/api/x402/transactions/{transaction_id}",
                params={"network": network},
                headers=headers,
                timeout=30,
            )
            response.raise_for_status()

            yield self.create_text_message(response.text)
        except Exception as e:
            raise ToolInvokeError(str(e))
