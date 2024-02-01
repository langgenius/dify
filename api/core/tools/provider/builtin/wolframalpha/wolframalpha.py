from typing import Any, Dict, List

from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.wolframalpha.tools.wolframalpha import WolframAlphaTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.tool.tool import Tool


class GoogleProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        try:
            WolframAlphaTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "query": "1+2+....+111",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))