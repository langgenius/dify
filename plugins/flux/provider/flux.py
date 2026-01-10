from __future__ import annotations

from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from tools.acedata_client import AceDataFluxClient, AceDataFluxError


class FluxProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        token = credentials.get("acedata_bearer_token")
        if not isinstance(token, str) or not token.strip():
            raise ToolProviderCredentialValidationError("Missing `acedata_bearer_token`.")

        client = AceDataFluxClient(bearer_token=token)
        try:
            client.generate(
                prompt="ping",
                model="flux-dev",
                count=1,
                callback_url="https://example.com",
                timeout_s=30,
            )
        except Exception as e:
            if isinstance(e, AceDataFluxError):
                raise ToolProviderCredentialValidationError(str(e)) from e

            raise ToolProviderCredentialValidationError(f"Credential validation failed: {e!s}") from e

