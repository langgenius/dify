from typing import Any

from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.stablediffusion.tools.stable_diffusion import StableDiffusionTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class StableDiffusionProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            StableDiffusionTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).validate_models()
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
    
    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.IMAGE
        ]