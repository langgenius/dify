from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.provider.builtin.dalle.tools.dalle2 import DallE2Tool
from core.tools.errors import ToolProviderCredentialValidationError

from typing import Any, Dict

class DALLEProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: Dict[str, Any]) -> None:
        try:
            DallE2Tool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_paramters={
                    "prompt": "cute girl, blue eyes, white hair, anime style",
                    "size": "small",
                    "n": 1
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))