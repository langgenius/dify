from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class ImageLoaderProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        return None
        