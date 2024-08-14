from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.stepfun.tools.image import StepfunTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class StepfunProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            StepfunTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "prompt": "cute girl, blue eyes, white hair, anime style",
                    "size": "1024x1024",
                    "n": 1
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        