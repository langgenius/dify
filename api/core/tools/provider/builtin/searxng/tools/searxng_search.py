from typing import Any

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class SearXNGSearchTool(BuiltinTool):
    """
    Tool for performing a search using SearXNG engine.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invoke the SearXNG search tool.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Any]): The parameters for the tool invocation.

        Returns:
            ToolInvokeMessage | list[ToolInvokeMessage]: The result of the tool invocation.
        """

        host = self.runtime.credentials.get("searxng_base_url")
        if not host:
            raise Exception("SearXNG api is required")

        response = requests.get(
            host,
            params={
                "q": tool_parameters.get("query"),
                "format": "json",
                "categories": tool_parameters.get("search_type", "general"),
            },
        )

        if response.status_code != 200:
            raise Exception(f"Error {response.status_code}: {response.text}")

        res = response.json().get("results", [])
        if not res:
            return self.create_text_message(f"No results found, get response: {response.content}")

        return [self.create_json_message(item) for item in res]
