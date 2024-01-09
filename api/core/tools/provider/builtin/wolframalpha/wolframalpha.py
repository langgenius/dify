from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.provider.tool import Tool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError

from core.tools.provider.builtin.wolframalpha.tools.wolframalpha import WolframAlphaTool

from typing import Any, Dict, List

class GoogleProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        try:
            WolframAlphaTool().invoke(
                tool_paramters={
                    "query": "1+2+....+111",
                },
                credentials=credentials,
                prompt_messages=[]
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))