from core.tools.entities.assistant_entities import AssistantAppMessage, AssistantAppType
from core.tools.provider.assistant_tool import AssistantTool
from core.tools.provider.tool_provider import AssistantToolProvider

from typing import Any, Dict, List

class GoogleProvider(AssistantToolProvider):
    def validate_credentials(self, tool_name: str, credentials: Dict[str, Any]) -> None:
        pass