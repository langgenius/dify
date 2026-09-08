import json
from http import HTTPStatus
from typing import Never

import httpx

from core.helper.http_client_pooling import get_pooled_http_client
from services.auth.errors import (
    DataSourceApiKeyAuthCredentialValidationError,
    DataSourceApiKeyAuthProviderUnavailableError,
    InvalidDataSourceApiKeyAuthCredentialsError,
)
from services.entities.data_source_api_key_auth_entities import DataSourceApiKeyAuthCredentials

_http_client: httpx.Client = get_pooled_http_client(
    "auth:jina",
    lambda: httpx.Client(
        timeout=httpx.Timeout(10.0),
        limits=httpx.Limits(max_keepalive_connections=50, max_connections=100),
    ),
)


class JinaAuth:
    def __init__(self, credentials: DataSourceApiKeyAuthCredentials):
        if credentials.auth_type != "bearer":
            raise InvalidDataSourceApiKeyAuthCredentialsError("Invalid auth type, Jina Reader auth type must be Bearer")
        self.api_key = credentials.api_key

        if not self.api_key:
            raise InvalidDataSourceApiKeyAuthCredentialsError("No API key provided")

    def validate_credentials(self) -> bool:
        headers = self._prepare_headers()
        options = {
            "url": "https://example.com",
        }
        response = self._post_request("https://r.jina.ai", options, headers)
        if response.status_code == 200:
            return True
        else:
            self._handle_error(response)

    def _prepare_headers(self):
        return {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}

    def _post_request(self, url, data, headers):
        return _http_client.post(url, headers=headers, json=data)

    def _handle_error(self, response) -> Never:
        if (
            response.status_code == HTTPStatus.TOO_MANY_REQUESTS
            or response.status_code >= HTTPStatus.INTERNAL_SERVER_ERROR
        ):
            raise DataSourceApiKeyAuthProviderUnavailableError("jinareader", response.status_code)

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
