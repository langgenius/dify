from __future__ import annotations

from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from tools.acedata_client import AceDataNanoBananaClient, AceDataNanoBananaError


class NanoBananaProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        token = credentials.get("acedata_bearer_token")
        if not isinstance(token, str) or not token.strip():
            raise ToolProviderCredentialValidationError("Missing `acedata_bearer_token`.")

        client = AceDataNanoBananaClient(bearer_token=token)
        try:
            client.generate(
                prompt="ping",
                model="nano-banana",
                aspect_ratio="1:1",
                resolution="1K",
                timeout_s=30,
            )
        except AceDataNanoBananaError as e:
            raise ToolProviderCredentialValidationError(str(e)) from e
        except Exception as e:
            raise ToolProviderCredentialValidationError(f"Credential validation failed: {e!s}") from e
