from __future__ import annotations

from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from tools.acedata_client import _normalize_token


class SoraProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        token = credentials.get("acedata_bearer_token")
        if not isinstance(token, str) or not token.strip():
            raise ToolProviderCredentialValidationError("Missing `acedata_bearer_token`.")

        if not _normalize_token(token):
            raise ToolProviderCredentialValidationError("Empty bearer token.")

