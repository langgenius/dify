# pyright: reportMissingImports=false

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.client import AgentPayMCPClient
from tools.common import to_int


class GetUsageTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        client = AgentPayMCPClient.from_credentials(self.runtime.credentials)
        payload = {
            "limit": to_int(tool_parameters.get("limit"), default=20),
        }
        result = client.call_tool("get_usage", payload)
        yield self.create_json_message(result)
