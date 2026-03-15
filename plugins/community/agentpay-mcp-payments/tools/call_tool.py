# pyright: reportMissingImports=false

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.client import AgentPayMCPClient
from tools.common import parse_json_object


class CallToolTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        tool_name = str(tool_parameters.get("tool_name") or "").strip()
        if not tool_name:
            raise ValueError("tool_name is required")

        arguments = parse_json_object(
            tool_parameters.get("arguments_json"),
            field_name="arguments_json",
        )

        client = AgentPayMCPClient.from_credentials(self.runtime.credentials)
        result = client.call_tool("call_tool", {"tool": tool_name, "arguments": arguments})
        yield self.create_json_message(result)
