from __future__ import annotations

from collections.abc import Generator, Mapping

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from common.client import MrscraperClient, ResponseData


class MrscraperTool(Tool):
    def _client(self) -> MrscraperClient:
        token = self.runtime.credentials.get("api_token")
        return MrscraperClient(token if isinstance(token, str) else "")

    def _messages(self, response: ResponseData) -> Generator[ToolInvokeMessage, None, None]:
        if isinstance(response, str):
            yield self.create_text_message(response)
        elif isinstance(response, Mapping | list):
            yield self.create_json_message(response)
