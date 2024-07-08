from collections.abc import Generator
from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from models.account import Tenant


class PluginInvokeService:
    @classmethod
    def invoke_tool(cls, user_id: str, tenant: Tenant, 
                    tool_provider: str, tool_name: str,
                    tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        """
        Invokes a tool with the given user ID and tool parameters.
        """
        