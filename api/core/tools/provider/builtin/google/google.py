from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.provider.tool import Tool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError

from core.tools.provider.builtin.google.tools.google_search import GoogleSearchTool

from typing import Any, Dict, List

class GoogleProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        try:
            GoogleSearchTool().invoke(
                user_id='',
                tool_paramters={
                    "query": "test",
                    "result_type": "link"
                },
                credentials=credentials,
                prompt_messages=[]
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))