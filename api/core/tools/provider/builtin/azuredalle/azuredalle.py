from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.provider.builtin.azuredalle.tools.dalle3 import DallE3Tool
from core.tools.errors import ToolProviderCredentialValidationError

from typing import Any, Dict

class AzureDALLEProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        try:
            DallE3Tool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "prompt": "cute girl, blue eyes, white hair, anime style",
                    "size": "square",
                    "n": 1
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
