from core.tools.entities.tool_entities import AssistantAppMessage, ToolProviderType
from core.tools.provider.tool import Tool
from core.tools.provider.tool_provider import ToolProvider
from core.tools.errors import ToolProviderCredentialValidationError

from core.tools.provider.builtin.google.tools.google_search import GoogleSearchTool

from typing import Any, Dict, List

class GoogleProvider(ToolProvider):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        try:
            GoogleSearchTool().invoke(
                tool_paramters={
                    "query": "test",
                    "result_type": "link"
                },
                credentials=credentials,
                prompt_messages=[]
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))