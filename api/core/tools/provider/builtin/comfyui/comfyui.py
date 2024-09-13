from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.comfyui.tools.comfyui_stable_diffusion import ComfyuiStableDiffusionTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class ComfyUIProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            ComfyuiStableDiffusionTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).validate_models()
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
