from typing import Any, override

from core.helper import ssrf_proxy
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.builtin_tool.providers.twelvelabs.tools.analyze import DEFAULT_BASE_URL
from core.tools.errors import ToolProviderCredentialValidationError


class TwelveLabsToolProvider(BuiltinToolProviderController):
    @override
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]):
        api_key = credentials.get("api_key")
        if not api_key:
            raise ToolProviderCredentialValidationError("TwelveLabs API key is required.")

        base_url = (credentials.get("base_url") or DEFAULT_BASE_URL).rstrip("/")
        try:
            # A cheap authenticated call: listing indexes verifies the key without spending analyze quota.
            response = ssrf_proxy.get(
                f"{base_url}/indexes",
                headers={"x-api-key": api_key},
                params={"page_limit": 1},
                timeout=(10, 30),
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(f"Failed to reach TwelveLabs API: {e}")

        if response.status_code in (401, 403):
            raise ToolProviderCredentialValidationError("Invalid TwelveLabs API key.")
        if response.status_code >= 400:
            raise ToolProviderCredentialValidationError(
                f"TwelveLabs credential validation failed ({response.status_code}): {response.text}"
            )
