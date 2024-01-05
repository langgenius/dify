from core.tools.entities.assistant_entities import AssistantAppMessage, AssistantAppType
from core.tools.provider.assistant_tool import AssistantTool
from core.tools.provider.tool_provider import AssistantToolProvider
from core.tools.errors import AssistantProviderCredentialValidationError

from core.tools.provider.builtin.google.tools.google_search import GoogleSearchTool

from typing import Any, Dict, List

class GoogleProvider(AssistantToolProvider):
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
            raise AssistantProviderCredentialValidationError(str(e))