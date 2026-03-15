# pyright: reportMissingImports=false

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.client import AgentPayMCPClient


class CheckBalanceTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        _ = tool_parameters
        client = AgentPayMCPClient.from_credentials(self.runtime.credentials)
        # Always pass the gatewayKey in arguments for MCP compatibility
        result = client.call_tool("check_balance", {"gatewayKey": client.gateway_key})
        yield self.create_json_message(result)
