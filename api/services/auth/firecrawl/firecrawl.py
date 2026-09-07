import json
from http import HTTPStatus
from typing import Never

import httpx

from services.auth.errors import (
    DataSourceApiKeyAuthCredentialValidationError,
    DataSourceApiKeyAuthProviderUnavailableError,
    InvalidDataSourceApiKeyAuthCredentialsError,
)
from services.entities.data_source_api_key_auth_entities import DataSourceApiKeyAuthCredentials

# Explicit bounded timeout for credential-validation requests so a slow or
# hanging Firecrawl endpoint cannot block the worker indefinitely.
_CREDENTIAL_TIMEOUT = httpx.Timeout(10.0)


class FirecrawlAuth:
    def __init__(self, credentials: DataSourceApiKeyAuthCredentials):
        if credentials.auth_type != "bearer":
            raise InvalidDataSourceApiKeyAuthCredentialsError("Invalid auth type, Firecrawl auth type must be Bearer")
        self.api_key = credentials.api_key
        self.base_url = credentials.options.get("base_url", "https://api.firecrawl.dev")

        if not self.api_key:
            raise InvalidDataSourceApiKeyAuthCredentialsError("No API key provided")

    def validate_credentials(self) -> bool:
        headers = self._prepare_headers()
        options = {
            "url": "https://example.com",
            "includePaths": [],
            "excludePaths": [],
            "limit": 1,
            "scrapeOptions": {"onlyMainContent": True},
        }
        response = self._post_request(self._build_url("v1/crawl"), options, headers)
        if response.status_code == 200:
            return True
        else:
            self._handle_error(response)

    def _prepare_headers(self):
        return {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}

    def _build_url(self, path: str) -> str:
        # ensure exactly one slash between base and path, regardless of user-provided base_url
        return f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"

    def _post_request(self, url, data, headers):
        return httpx.post(url, headers=headers, json=data, timeout=_CREDENTIAL_TIMEOUT)

    def _handle_error(self, response) -> Never:
        if (
            response.status_code == HTTPStatus.TOO_MANY_REQUESTS
            or response.status_code >= HTTPStatus.INTERNAL_SERVER_ERROR
        ):
            raise DataSourceApiKeyAuthProviderUnavailableError("firecrawl", response.status_code)

        try:
            payload = response.json()
        except json.JSONDecodeError:
            payload = {}
        error_message = payload.get("error") or payload.get("message") or (response.text or "Unknown error occurred")
        raise DataSourceApiKeyAuthCredentialValidationError(
            f"Failed to authorize. Status code: {response.status_code}. Error: {error_message}"
        )
