from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class OneBotProvider(BuiltinToolProviderController):

    def _validate_credentials(self, credentials: dict[str, Any]) -> None:

        if not credentials.get("ob11_http_url"):
            raise ToolProviderCredentialValidationError('OneBot HTTP URL is required.')
