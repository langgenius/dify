# pyright: reportMissingImports=false

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.client import AgentPayMCPClient
from tools.common import to_int


class DiscoverToolsTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        client = AgentPayMCPClient.from_credentials(self.runtime.credentials)
        payload = {
            "query": tool_parameters.get("query", ""),
            "limit": to_int(tool_parameters.get("limit"), default=10),
        }
        result = client.call_tool("discover_tools", payload)
        yield self.create_json_message(result)
