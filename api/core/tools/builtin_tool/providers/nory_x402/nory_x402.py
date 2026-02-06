from typing import Any

from core.tools.builtin_tool.provider import BuiltinToolProviderController


class NoryX402Provider(BuiltinToolProviderController):
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]):
        """
        Validate credentials - API key is optional for Nory
        """
        pass
