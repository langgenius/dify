import json
from http import HTTPStatus
from typing import Never
from urllib.parse import urljoin

import httpx

from services.auth.errors import (
    DataSourceApiKeyAuthCredentialValidationError,
    DataSourceApiKeyAuthProviderUnavailableError,
    InvalidDataSourceApiKeyAuthCredentialsError,
)
from services.entities.data_source_api_key_auth_entities import DataSourceApiKeyAuthCredentials

# Explicit bounded timeout for credential-validation requests so a slow or
# hanging WaterCrawl endpoint cannot block the worker indefinitely.
_CREDENTIAL_TIMEOUT = httpx.Timeout(10.0)


class WatercrawlAuth:
    def __init__(self, credentials: DataSourceApiKeyAuthCredentials):
        if credentials.auth_type != "x-api-key":
            raise InvalidDataSourceApiKeyAuthCredentialsError(
                "Invalid auth type, WaterCrawl auth type must be x-api-key"
            )
        self.api_key = credentials.api_key
        self.base_url = credentials.options.get("base_url", "https://app.watercrawl.dev")

        if not self.api_key:
            raise InvalidDataSourceApiKeyAuthCredentialsError("No API key provided")

    def validate_credentials(self) -> bool:
        headers = self._prepare_headers()
        url = urljoin(self.base_url, "/api/v1/core/crawl-requests/")
        response = self._get_request(url, headers)
        if response.status_code == 200:
            return True
        else:
            self._handle_error(response)

    def _prepare_headers(self):
        return {"Content-Type": "application/json", "X-API-KEY": self.api_key}

    def _get_request(self, url, headers):
        return httpx.get(url, headers=headers, timeout=_CREDENTIAL_TIMEOUT)

    def _handle_error(self, response) -> Never:
        if (
            response.status_code == HTTPStatus.TOO_MANY_REQUESTS
            or response.status_code >= HTTPStatus.INTERNAL_SERVER_ERROR
        ):
            raise DataSourceApiKeyAuthProviderUnavailableError("watercrawl", response.status_code)

        if response.status_code in {402, 409}:
            try:
                error_message = response.json().get("error", "Unknown error occurred")
            except json.JSONDecodeError:
                error_message = response.text or "Unknown error occurred"
            raise DataSourceApiKeyAuthCredentialValidationError(
                f"Failed to authorize. Status code: {response.status_code}. Error: {error_message}"
            )
        else:
            if response.text:
                try:
                    error_message = json.loads(response.text).get("error", "Unknown error occurred")
                except json.JSONDecodeError:
                    error_message = response.text
                raise DataSourceApiKeyAuthCredentialValidationError(
                    f"Failed to authorize. Status code: {response.status_code}. Error: {error_message}"
                )
            raise DataSourceApiKeyAuthCredentialValidationError(
                f"Unexpected error occurred while trying to authorize. Status code: {response.status_code}"
            )
