from core.tools.entities.tool_entities import AssistantAppMessage, ToolProviderType
from core.tools.provider.tool import Tool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController

from typing import Any, Dict, List

class DALLEProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        pass