from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.stablediffusion.tools.stable_diffusion import StableDiffusionTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class StableDiffusionProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            StableDiffusionTool().fork_tool_runtime(
                meta={
                    "credentials": credentials,
                }
            ).validate_models()
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))