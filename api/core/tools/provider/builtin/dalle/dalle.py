from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.dalle.tools.dalle2 import DallE2Tool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class DALLEProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            DallE2Tool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={"prompt": "cute girl, blue eyes, white hair, anime style", "size": "small", "n": 1},
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
