from core.tools.entities.tool_entities import AssistantAppMessage, ToolProviderType
from core.tools.provider.tool import Tool
from core.tools.provider.tool_provider import ToolProvider

from typing import Any, Dict, List

class DALLEProvider(ToolProvider):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        pass