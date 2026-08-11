from unittest.mock import MagicMock, patch

import httpx
import pytest

from services.auth.data_source_api_key_auth_gateways import ProviderApiKeyAuthCredentialValidator
from services.auth.errors import (
    DataSourceApiKeyAuthCredentialValidationError,
    DataSourceApiKeyAuthProviderUnavailableError,
    UnsupportedDataSourceApiKeyAuthProviderError,
)
from services.entities.data_source_api_key_auth_entities import DataSourceApiKeyAuthCredentials


class TestProviderApiKeyAuthCredentialValidator:
    @pytest.mark.parametrize(
        ("provider", "auth_class_path", "credentials"),
        [
            (
                "firecrawl",
                "services.auth.firecrawl.firecrawl.FirecrawlAuth",
                DataSourceApiKeyAuthCredentials("bearer", "test_key", {}),
            ),
            (
                "watercrawl",
                "services.auth.watercrawl.watercrawl.WatercrawlAuth",
                DataSourceApiKeyAuthCredentials("x-api-key", "test_key", {}),
            ),
            (
                "jinareader",
                "services.auth.jina.jina.JinaAuth",
                DataSourceApiKeyAuthCredentials("bearer", "test_key", {}),
            ),
        ],
    )
    def test_validate_routes_to_provider(
        self,
        provider: str,
        auth_class_path: str,
        credentials: DataSourceApiKeyAuthCredentials,
    ) -> None:
        auth_instance = MagicMock()
        auth_instance.validate_credentials.return_value = True

        with patch(auth_class_path, autospec=True, return_value=auth_instance) as auth_factory:
            result = ProviderApiKeyAuthCredentialValidator().validate(provider, credentials)

        assert result is True
        auth_factory.assert_called_once_with(credentials)
        auth_instance.validate_credentials.assert_called_once_with()

    @pytest.mark.parametrize("invalid_provider", ["invalid_provider", "", "UNSUPPORTED"])
    def test_validate_rejects_unknown_provider(self, invalid_provider: str) -> None:
        credentials = DataSourceApiKeyAuthCredentials("bearer", "test_key", {})

        with pytest.raises(
            UnsupportedDataSourceApiKeyAuthProviderError,
            match=f"Unsupported data-source API-key auth provider: {invalid_provider}",
        ):
            ProviderApiKeyAuthCredentialValidator().validate(invalid_provider, credentials)

    @pytest.mark.parametrize("validation_result", [True, False])
    def test_validate_returns_provider_result(self, validation_result: bool) -> None:
        auth_instance = MagicMock()
        auth_instance.validate_credentials.return_value = validation_result

        with patch(
            "services.auth.firecrawl.firecrawl.FirecrawlAuth",
            autospec=True,
            return_value=auth_instance,
        ):
            result = ProviderApiKeyAuthCredentialValidator().validate(
                "firecrawl",
                DataSourceApiKeyAuthCredentials("bearer", "test_key", {}),
            )

        assert result is validation_result

    def test_validate_propagates_credential_validation_error(self) -> None:
        auth_instance = MagicMock()
        auth_instance.validate_credentials.side_effect = DataSourceApiKeyAuthCredentialValidationError(
            "Authentication error"
        )

        with patch(
            "services.auth.firecrawl.firecrawl.FirecrawlAuth",
            autospec=True,
            return_value=auth_instance,
        ):
            with pytest.raises(DataSourceApiKeyAuthCredentialValidationError, match="Authentication error"):
                ProviderApiKeyAuthCredentialValidator().validate(
                    "firecrawl",
                    DataSourceApiKeyAuthCredentials("bearer", "test_key", {}),
                )

    def test_validate_maps_provider_network_error(self) -> None:
        auth_instance = MagicMock()
        auth_instance.validate_credentials.side_effect = httpx.ConnectError("Authentication endpoint unavailable")

        with patch(
            "services.auth.firecrawl.firecrawl.FirecrawlAuth",
            autospec=True,
            return_value=auth_instance,
        ):
            with pytest.raises(
                DataSourceApiKeyAuthProviderUnavailableError,
                match="Data-source API-key auth provider is unavailable: firecrawl",
            ):
                ProviderApiKeyAuthCredentialValidator().validate(
                    "firecrawl",
                    DataSourceApiKeyAuthCredentials("bearer", "test_key", {}),
                )

    def test_validate_does_not_map_non_transport_http_error(self) -> None:
        request = httpx.Request("POST", "https://api.firecrawl.dev/v1/crawl")
        response = httpx.Response(500, request=request)
        status_error = httpx.HTTPStatusError("Provider returned an error", request=request, response=response)
        auth_instance = MagicMock()
        auth_instance.validate_credentials.side_effect = status_error

        with patch(
            "services.auth.firecrawl.firecrawl.FirecrawlAuth",
            autospec=True,
            return_value=auth_instance,
        ):
            with pytest.raises(httpx.HTTPStatusError) as exc_info:
                ProviderApiKeyAuthCredentialValidator().validate(
                    "firecrawl",
                    DataSourceApiKeyAuthCredentials("bearer", "test_key", {}),
                )

        assert exc_info.value is status_error
