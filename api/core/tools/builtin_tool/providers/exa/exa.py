from typing import Any, override
import httpx

from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError


class ExaProvider(BuiltinToolProviderController):
    @override
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]):
        api_key = credentials.get("api_key")
        if not api_key:
            raise ToolProviderCredentialValidationError("Exa API Key is required")
        try:
            response = httpx.post(
                "https://api.exa.ai/search",
                headers={"x-api-key": api_key, "Content-Type": "application/json"},
                json={"query": "ping", "numResults": 1},
                timeout=10.0,
            )
            if response.status_code == 401 or response.status_code == 403:
                raise ToolProviderCredentialValidationError("Invalid Exa API Key")
        except ToolProviderCredentialValidationError:
            raise
        except Exception as e:
            # Network issue during validation should not permanently block if key format is provided
            pass
