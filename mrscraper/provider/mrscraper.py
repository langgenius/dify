from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from common.client import MrscraperAPIError, MrscraperClient, sanitize_error


class MrscraperProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        token_value = credentials.get("api_token")
        if not isinstance(token_value, str) or not token_value.strip():
            raise ToolProviderCredentialValidationError("MrScraper API token is required.")

        token = token_value.strip()
        try:
            MrscraperClient(token).request(
                "GET",
                origin=MrscraperClient.PRIMARY_ORIGIN,
                path="/api/v1/subscription-accounts",
                auth="primary",
            )
        except MrscraperAPIError as exc:
            raise ToolProviderCredentialValidationError(
                f"MrScraper could not validate this API token: {sanitize_error(str(exc), token)}"
            ) from None
        except Exception as exc:
            raise ToolProviderCredentialValidationError(
                f"MrScraper credential validation failed: {sanitize_error(str(exc), token)}"
            ) from None
