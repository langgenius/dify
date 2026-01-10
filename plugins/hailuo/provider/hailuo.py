from __future__ import annotations

from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from tools.acedata_client import AceDataHailuoClient, AceDataHailuoError, _normalize_token


class HailuoProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        token = credentials.get("acedata_bearer_token")
        if not isinstance(token, str) or not token.strip():
            raise ToolProviderCredentialValidationError("Missing `acedata_bearer_token`.")

        if not _normalize_token(token):
            raise ToolProviderCredentialValidationError("Empty bearer token.")

        client = AceDataHailuoClient(bearer_token=token)
        try:
            client.generate_video(
                action="generate",
                model="minimax-t2v",
                prompt="ping",
                timeout_s=30,
            )
        except Exception as e:
            if isinstance(e, AceDataHailuoError):
                raise ToolProviderCredentialValidationError(str(e)) from e

            raise ToolProviderCredentialValidationError(f"Credential validation failed: {e!s}") from e
