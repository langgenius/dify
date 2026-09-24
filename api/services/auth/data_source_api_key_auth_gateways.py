"""Outer adapters used by the data-source API-key auth application service."""

from collections.abc import Callable
from typing import Protocol, override

import httpx

from core.helper import encrypter
from services.auth.data_source_api_key_auth_service import ApiKeyAuthCredentialEncryptor, ApiKeyAuthCredentialValidator
from services.auth.errors import (
    DataSourceApiKeyAuthProviderUnavailableError,
    UnsupportedDataSourceApiKeyAuthProviderError,
)
from services.entities.data_source_api_key_auth_entities import DataSourceApiKeyAuthCredentials


class _ProviderApiKeyAuthValidator(Protocol):
    def validate_credentials(self) -> bool: ...


type _ProviderApiKeyAuthValidatorFactory = Callable[
    [DataSourceApiKeyAuthCredentials],
    _ProviderApiKeyAuthValidator,
]


def _get_provider_validator_factory(provider: str) -> _ProviderApiKeyAuthValidatorFactory:
    match provider:
        case "firecrawl":
            from services.auth.firecrawl.firecrawl import FirecrawlAuth

            return FirecrawlAuth
        case "watercrawl":
            from services.auth.watercrawl.watercrawl import WatercrawlAuth

            return WatercrawlAuth
        case "jinareader":
            from services.auth.jina.jina import JinaAuth

            return JinaAuth
        case _:
            raise UnsupportedDataSourceApiKeyAuthProviderError(provider)


class ProviderApiKeyAuthCredentialValidator(ApiKeyAuthCredentialValidator):
    @override
    def validate(self, provider: str, credentials: DataSourceApiKeyAuthCredentials) -> bool:
        validator_factory = _get_provider_validator_factory(provider)
        try:
            return validator_factory(credentials).validate_credentials()
        except httpx.TransportError as exc:
            raise DataSourceApiKeyAuthProviderUnavailableError(provider) from exc


class TenantApiKeyAuthCredentialEncryptor(ApiKeyAuthCredentialEncryptor):
    @override
    def encrypt(self, workspace_id: str, token: str) -> str:
        return encrypter.encrypt_token(workspace_id, token)
