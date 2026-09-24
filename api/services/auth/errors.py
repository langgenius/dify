"""Errors exposed by the data-source API-key authentication use case."""

from typing import ClassVar


class DataSourceApiKeyAuthError(Exception):
    error_code: ClassVar[str] = "data_source_api_key_auth_error"
    default_message: ClassVar[str] = "Data-source API-key authentication failed."

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.default_message
        super().__init__(self.message)


class InvalidDataSourceApiKeyAuthCredentialsError(DataSourceApiKeyAuthError):
    error_code = "invalid_data_source_api_key_auth_credentials"
    default_message = "The data-source API-key credentials are invalid."


class DataSourceApiKeyAuthCredentialValidationError(DataSourceApiKeyAuthError):
    error_code = "data_source_api_key_auth_credentials_rejected"
    default_message = "The data-source provider rejected the API-key credentials."


class DataSourceApiKeyAuthProviderUnavailableError(DataSourceApiKeyAuthError):
    error_code = "data_source_api_key_auth_provider_unavailable"

    def __init__(self, provider: str, status_code: int | None = None) -> None:
        self.provider = provider
        self.status_code = status_code
        status_suffix = f" (status code: {status_code})" if status_code is not None else ""
        super().__init__(f"Data-source API-key auth provider is unavailable: {provider}{status_suffix}")


class UnsupportedDataSourceApiKeyAuthProviderError(DataSourceApiKeyAuthError):
    error_code = "unsupported_data_source_api_key_auth_provider"

    def __init__(self, provider: str) -> None:
        self.provider = provider
        super().__init__(f"Unsupported data-source API-key auth provider: {provider}")
