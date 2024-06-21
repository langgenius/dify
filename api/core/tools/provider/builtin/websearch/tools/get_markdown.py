from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

BASE_URL = "https://api.serply.io/v1/request"


class SerplyApi:
    """
    SerplyAPI tool provider.
    """

    def __init__(self, api_key: str) -> None:
        """Initialize SerplyAPI tool provider."""
        self.serply_api_key = api_key

    def run(self, url: str, **kwargs: Any) -> str:
        """Run query through SerplyAPI and parse result."""

        location = kwargs.get("location", "US")

        headers = {
            "X-API-KEY": self.serply_api_key,
            "X-User-Agent": kwargs.get("device", "desktop"),
            "X-Proxy-Location": location,
            "User-Agent": "Dify",
        }
        data = {"url": url, "method": "GET", "response_type": "markdown"}
        res = requests.post(url, headers=headers, json=data)
        return res.text


class GetMarkdownTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke the SerplyApi tool.
        """
        url = tool_parameters["url"]
        location = tool_parameters.get("location", None)

        api_key = self.runtime.credentials["serply_api_key"]
        result = SerplyApi(api_key).run(url, location=location)

        return self.create_text_message(text=result)
