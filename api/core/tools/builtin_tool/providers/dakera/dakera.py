from typing import Any, override

import httpx

from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.errors import ToolProviderCredentialValidationError


class DakeraProvider(BuiltinToolProviderController):
    @override
    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        """Validate that the Dakera server is reachable with the provided credentials."""
        api_url = credentials.get("api_url", "").rstrip("/")
        api_key = credentials.get("api_key", "")

        if not api_url:
            raise ToolProviderCredentialValidationError("Dakera server URL is required.")

        headers: dict[str, str] = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            resp = httpx.get(f"{api_url}/health/live", headers=headers, timeout=5.0)
            if resp.status_code not in (200, 204):
                raise ToolProviderCredentialValidationError(
                    f"Dakera health check failed with HTTP {resp.status_code}. "
                    "Verify the server URL and API key."
                )
        except httpx.RequestError as exc:
            raise ToolProviderCredentialValidationError(
                f"Cannot reach Dakera server at {api_url}: {exc}. "
                "Make sure the server is running: "
                "docker run -p 3300:3300 -e DAKERA_API_KEY=demo ghcr.io/dakera-ai/dakera:latest"
            )
