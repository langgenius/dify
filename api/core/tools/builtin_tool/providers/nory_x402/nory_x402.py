from typing import Any

import requests

from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError

# Centralized API base URL for all Nory x402 tools
NORY_API_BASE = "https://noryx402.com"


class NoryX402Provider(BuiltinToolProviderController):
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]):
        """
        Validate credentials by checking API health.
        API key is optional for Nory, but we verify the service is reachable.
        """
        try:
            response = requests.get(f"{NORY_API_BASE}/api/x402/health", timeout=10)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            raise ToolProviderCredentialValidationError(
                f"Failed to connect to Nory x402 service: {e}"
            )
