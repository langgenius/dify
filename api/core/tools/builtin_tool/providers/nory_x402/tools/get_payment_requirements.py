from collections.abc import Generator
from typing import Any

import requests

from core.tools.builtin_tool.providers.nory_x402.nory_x402 import NORY_API_BASE
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


class GetPaymentRequirementsTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Get x402 payment requirements for a resource.
        """
        try:
            resource = tool_parameters.get("resource", "")
            amount = tool_parameters.get("amount", "")
            network = tool_parameters.get("network")

            if not resource:
                yield self.create_text_message("Please provide a resource path")
                return

            if not amount:
                yield self.create_text_message("Please provide an amount")
                return

            params = {"resource": resource, "amount": amount}
            if network:
                params["network"] = network

            headers = {}
            api_key = self.runtime.credentials.get("api_key")
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"

            response = requests.get(
                f"{NORY_API_BASE}/api/x402/requirements",
                params=params,
                headers=headers,
                timeout=30,
            )
            response.raise_for_status()

            yield self.create_text_message(response.text)
        except requests.exceptions.RequestException as e:
            raise ToolInvokeError(f"Request failed: {e}")
