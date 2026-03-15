# pyright: reportMissingImports=false

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.client import AgentPayMCPClient


class FundWalletStripeTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        client = AgentPayMCPClient.from_credentials(self.runtime.credentials)
        payload = {
            "package": str(tool_parameters.get("package") or "micro"),
        }
        result = client.call_tool("fund_wallet_stripe", payload)
        yield self.create_json_message(result)
