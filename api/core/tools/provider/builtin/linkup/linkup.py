from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class LinkupProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
            if "linkup_api_key" not in credentials or not credentials.get("linkup_api_key"):
                raise ToolProviderCredentialValidationError("Linkup API key is required.")
