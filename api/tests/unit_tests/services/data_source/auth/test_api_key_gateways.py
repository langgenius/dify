from collections.abc import Callable

import httpx
import pytest

from services.auth.errors import (
    DataSourceApiKeyAuthCredentialValidationError,
    DataSourceApiKeyAuthProviderUnavailableError,
    UnsupportedDataSourceApiKeyAuthProviderError,
)
from services.data_source.auth.api_key_gateways import ProviderApiKeyAuthCredentialValidator
from services.data_source.auth.firecrawl.firecrawl import FirecrawlAuth
from services.data_source.auth.jina.jina import JinaAuth
from services.data_source.auth.watercrawl.watercrawl import WatercrawlAuth
from services.data_source.entities.api_key_auth import DataSourceApiKeyAuthCredentials

type AuthClass = type[FirecrawlAuth] | type[JinaAuth] | type[WatercrawlAuth]
type AuthInstance = FirecrawlAuth | JinaAuth | WatercrawlAuth


def _record_auth_validation(
    monkeypatch: pytest.MonkeyPatch,
    *,
    auth_class: AuthClass,
    validate_credentials: Callable[[], bool],
) -> list[AuthInstance]:
    validation_calls: list[AuthInstance] = []

    def recording_validate_credentials(auth_instance: AuthInstance) -> bool:
        validation_calls.append(auth_instance)
        return validate_credentials()

    monkeypatch.setattr(auth_class, "validate_credentials", recording_validate_credentials)
    return validation_calls


class TestProviderApiKeyAuthCredentialValidator:
    @pytest.mark.parametrize(
        ("provider", "auth_class", "credentials"),
        [
            (
                "firecrawl",
                FirecrawlAuth,
                DataSourceApiKeyAuthCredentials("bearer", "test_key", {}),
            ),
            (
                "watercrawl",
                WatercrawlAuth,
                DataSourceApiKeyAuthCredentials("x-api-key", "test_key", {}),
            ),
            (
                "jinareader",
                JinaAuth,
                DataSourceApiKeyAuthCredentials("bearer", "test_key", {}),
            ),
        ],
    )
    def test_validate_routes_to_provider(
        self,
        provider: str,
        auth_class: AuthClass,
        credentials: DataSourceApiKeyAuthCredentials,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        validation_calls = _record_auth_validation(
            monkeypatch,
            auth_class=auth_class,
            validate_credentials=lambda: True,
        )

        result = ProviderApiKeyAuthCredentialValidator().validate(provider, credentials)

        assert result is True
        assert len(validation_calls) == 1
        assert type(validation_calls[0]) is auth_class
        assert validation_calls[0].api_key == credentials.api_key

    @pytest.mark.parametrize("invalid_provider", ["invalid_provider", "", "UNSUPPORTED"])
    def test_validate_rejects_unknown_provider(self, invalid_provider: str) -> None:
        credentials = DataSourceApiKeyAuthCredentials("bearer", "test_key", {})

        with pytest.raises(
            UnsupportedDataSourceApiKeyAuthProviderError,
            match=f"Unsupported data-source API-key auth provider: {invalid_provider}",
        ):
            ProviderApiKeyAuthCredentialValidator().validate(invalid_provider, credentials)

    @pytest.mark.parametrize("validation_result", [True, False])
    def test_validate_returns_provider_result(self, validation_result: bool, monkeypatch: pytest.MonkeyPatch) -> None:
        credentials = DataSourceApiKeyAuthCredentials("bearer", "test_key", {})
        _record_auth_validation(
            monkeypatch,
            auth_class=FirecrawlAuth,
            validate_credentials=lambda: validation_result,
        )

        result = ProviderApiKeyAuthCredentialValidator().validate("firecrawl", credentials)

        assert result is validation_result

    def test_validate_propagates_credential_validation_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        credentials = DataSourceApiKeyAuthCredentials("bearer", "test_key", {})

        def validate_credentials() -> bool:
            raise DataSourceApiKeyAuthCredentialValidationError("Authentication error")

        _record_auth_validation(
            monkeypatch,
            auth_class=FirecrawlAuth,
            validate_credentials=validate_credentials,
        )

        with pytest.raises(DataSourceApiKeyAuthCredentialValidationError, match="Authentication error"):
            ProviderApiKeyAuthCredentialValidator().validate("firecrawl", credentials)

    def test_validate_maps_provider_network_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        credentials = DataSourceApiKeyAuthCredentials("bearer", "test_key", {})

        def validate_credentials() -> bool:
            raise httpx.ConnectError("Authentication endpoint unavailable")

        _record_auth_validation(
            monkeypatch,
            auth_class=FirecrawlAuth,
            validate_credentials=validate_credentials,
        )

        with pytest.raises(
            DataSourceApiKeyAuthProviderUnavailableError,
            match="Data-source API-key auth provider is unavailable: firecrawl",
        ):
            ProviderApiKeyAuthCredentialValidator().validate("firecrawl", credentials)

    def test_validate_does_not_map_non_transport_http_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        request = httpx.Request("POST", "https://api.firecrawl.dev/v1/crawl")
        response = httpx.Response(500, request=request)
        status_error = httpx.HTTPStatusError("Provider returned an error", request=request, response=response)
        credentials = DataSourceApiKeyAuthCredentials("bearer", "test_key", {})

        def validate_credentials() -> bool:
            raise status_error

        _record_auth_validation(
            monkeypatch,
            auth_class=FirecrawlAuth,
            validate_credentials=validate_credentials,
        )

        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            ProviderApiKeyAuthCredentialValidator().validate("firecrawl", credentials)

        assert exc_info.value is status_error
