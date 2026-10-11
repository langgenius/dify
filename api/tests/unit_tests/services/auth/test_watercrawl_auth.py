from unittest.mock import MagicMock, patch

import httpx
import pytest

from services.auth.errors import (
    DataSourceApiKeyAuthCredentialValidationError,
    DataSourceApiKeyAuthProviderUnavailableError,
    InvalidDataSourceApiKeyAuthCredentialsError,
)
from services.data_source.auth.watercrawl.watercrawl import WatercrawlAuth
from services.data_source.entities.api_key_auth import DataSourceApiKeyAuthCredentials


def _credentials(
    auth_type: str = "x-api-key",
    api_key: str = "test_api_key_123",
    **options: str,
) -> DataSourceApiKeyAuthCredentials:
    return DataSourceApiKeyAuthCredentials(auth_type, api_key, options)


class TestWatercrawlAuth:
    @pytest.fixture
    def valid_credentials(self) -> DataSourceApiKeyAuthCredentials:
        """Fixture for valid x-api-key credentials"""
        return _credentials()

    @pytest.fixture
    def auth_instance(self, valid_credentials: DataSourceApiKeyAuthCredentials) -> WatercrawlAuth:
        """Fixture for WatercrawlAuth instance with valid credentials"""
        return WatercrawlAuth(valid_credentials)

    def test_should_initialize_with_valid_x_api_key_credentials(
        self, valid_credentials: DataSourceApiKeyAuthCredentials
    ) -> None:
        """Test successful initialization with valid x-api-key credentials"""
        auth = WatercrawlAuth(valid_credentials)
        assert auth.api_key == "test_api_key_123"
        assert auth.base_url == "https://app.watercrawl.dev"

    def test_should_initialize_with_custom_base_url(self) -> None:
        """Test initialization with custom base URL"""
        credentials = _credentials(base_url="https://custom.watercrawl.dev")
        auth = WatercrawlAuth(credentials)
        assert auth.api_key == "test_api_key_123"
        assert auth.base_url == "https://custom.watercrawl.dev"

    @pytest.mark.parametrize(
        ("auth_type", "expected_error"),
        [
            ("bearer", "Invalid auth type, WaterCrawl auth type must be x-api-key"),
            ("basic", "Invalid auth type, WaterCrawl auth type must be x-api-key"),
            ("", "Invalid auth type, WaterCrawl auth type must be x-api-key"),
        ],
    )
    def test_should_raise_error_for_invalid_auth_type(self, auth_type: str, expected_error: str) -> None:
        """Test that non-x-api-key auth types raise a credential error."""
        credentials = _credentials(auth_type=auth_type)
        with pytest.raises(InvalidDataSourceApiKeyAuthCredentialsError) as exc_info:
            WatercrawlAuth(credentials)
        assert str(exc_info.value) == expected_error

    def test_should_raise_error_for_empty_api_key(self) -> None:
        with pytest.raises(InvalidDataSourceApiKeyAuthCredentialsError, match="No API key provided"):
            WatercrawlAuth(_credentials(api_key=""))

    @patch("services.data_source.auth.watercrawl.watercrawl.httpx.get", autospec=True)
    def test_should_validate_valid_credentials_successfully(
        self, mock_get: MagicMock, auth_instance: WatercrawlAuth
    ) -> None:
        """Test successful credential validation"""
        mock_get.return_value = httpx.Response(200)

        result = auth_instance.validate_credentials()

        assert result is True
        mock_get.assert_called_once_with(
            "https://app.watercrawl.dev/api/v1/core/crawl-requests/",
            headers={"Content-Type": "application/json", "X-API-KEY": "test_api_key_123"},
            timeout=httpx.Timeout(10.0),
        )

    @pytest.mark.parametrize(
        ("status_code", "error_message"),
        [
            (402, "Payment required"),
            (409, "Conflict error"),
        ],
    )
    @patch("services.data_source.auth.watercrawl.watercrawl.httpx.get", autospec=True)
    def test_should_handle_http_errors(
        self, mock_get: MagicMock, status_code: int, error_message: str, auth_instance: WatercrawlAuth
    ) -> None:
        """Test handling of various HTTP error codes"""
        mock_get.return_value = httpx.Response(status_code, json={"error": error_message})

        with pytest.raises(DataSourceApiKeyAuthCredentialValidationError) as exc_info:
            auth_instance.validate_credentials()
        assert str(exc_info.value) == f"Failed to authorize. Status code: {status_code}. Error: {error_message}"

    @pytest.mark.parametrize("status_code", [429, 500, 502, 503])
    @patch("services.data_source.auth.watercrawl.watercrawl.httpx.get", autospec=True)
    def test_should_map_upstream_failure_to_provider_unavailable(
        self,
        mock_get: MagicMock,
        status_code: int,
        auth_instance: WatercrawlAuth,
    ) -> None:
        mock_get.return_value = httpx.Response(status_code)

        with pytest.raises(DataSourceApiKeyAuthProviderUnavailableError) as exc_info:
            auth_instance.validate_credentials()

        assert exc_info.value.provider == "watercrawl"
        assert exc_info.value.status_code == status_code

    @patch("services.data_source.auth.watercrawl.watercrawl.httpx.get", autospec=True)
    def test_should_handle_http_error_with_non_json_text_response(
        self, mock_get: MagicMock, auth_instance: WatercrawlAuth
    ) -> None:
        """Test handling of known HTTP errors with non-JSON text response."""
        mock_get.return_value = httpx.Response(402, text="Payment required")

        with pytest.raises(DataSourceApiKeyAuthCredentialValidationError) as exc_info:
            auth_instance.validate_credentials()
        assert str(exc_info.value) == "Failed to authorize. Status code: 402. Error: Payment required"

    @pytest.mark.parametrize(
        ("status_code", "response_text", "expected_error_contains"),
        [
            (403, '{"error": "Forbidden"}', "Failed to authorize. Status code: 403. Error: Forbidden"),
            (404, "", "Unexpected error occurred while trying to authorize. Status code: 404"),
            (401, "Not JSON", "Failed to authorize. Status code: 401. Error: Not JSON"),
        ],
    )
    @patch("services.data_source.auth.watercrawl.watercrawl.httpx.get", autospec=True)
    def test_should_handle_unexpected_errors(
        self,
        mock_get: MagicMock,
        status_code: int,
        response_text: str,
        expected_error_contains: str,
        auth_instance: WatercrawlAuth,
    ) -> None:
        """Test handling of unexpected errors with various response formats"""
        mock_get.return_value = httpx.Response(status_code, text=response_text)

        with pytest.raises(DataSourceApiKeyAuthCredentialValidationError) as exc_info:
            auth_instance.validate_credentials()
        assert expected_error_contains in str(exc_info.value)

    @pytest.mark.parametrize(
        ("exception_type", "exception_message"),
        [
            (httpx.ConnectError, "Network error"),
            (httpx.TimeoutException, "Request timeout"),
            (httpx.ReadTimeout, "Read timeout"),
            (httpx.ConnectTimeout, "Connection timeout"),
        ],
    )
    @patch("services.data_source.auth.watercrawl.watercrawl.httpx.get", autospec=True)
    def test_should_handle_network_errors(
        self,
        mock_get: MagicMock,
        exception_type: type[httpx.HTTPError],
        exception_message: str,
        auth_instance: WatercrawlAuth,
    ) -> None:
        """Test handling of various network-related errors including timeouts"""
        mock_get.side_effect = exception_type(exception_message)

        with pytest.raises(exception_type) as exc_info:
            auth_instance.validate_credentials()
        assert exception_message in str(exc_info.value)

    def test_should_not_expose_api_key_in_error_messages(self) -> None:
        """Test that API key is not exposed in error messages"""
        credentials = _credentials(api_key="super_secret_key_12345")
        auth = WatercrawlAuth(credentials)

        # Verify API key is stored but not in any error message
        assert auth.api_key == "super_secret_key_12345"

        # Test various error scenarios don't expose the key
        with pytest.raises(InvalidDataSourceApiKeyAuthCredentialsError) as exc_info:
            WatercrawlAuth(_credentials(auth_type="bearer", api_key="super_secret_key_12345"))
        assert "super_secret_key_12345" not in str(exc_info.value)

    @patch("services.data_source.auth.watercrawl.watercrawl.httpx.get", autospec=True)
    def test_should_use_custom_base_url_in_validation(self, mock_get: MagicMock) -> None:
        """Test that custom base URL is used in validation"""
        mock_get.return_value = httpx.Response(200)

        credentials = _credentials(base_url="https://custom.watercrawl.dev")
        auth = WatercrawlAuth(credentials)
        result = auth.validate_credentials()

        assert result is True
        assert mock_get.call_args[0][0] == "https://custom.watercrawl.dev/api/v1/core/crawl-requests/"

    @pytest.mark.parametrize(
        ("base_url", "expected_url"),
        [
            ("https://app.watercrawl.dev", "https://app.watercrawl.dev/api/v1/core/crawl-requests/"),
            ("https://app.watercrawl.dev/", "https://app.watercrawl.dev/api/v1/core/crawl-requests/"),
            ("https://app.watercrawl.dev//", "https://app.watercrawl.dev/api/v1/core/crawl-requests/"),
        ],
    )
    @patch("services.data_source.auth.watercrawl.watercrawl.httpx.get", autospec=True)
    def test_should_use_urljoin_for_url_construction(
        self, mock_get: MagicMock, base_url: str, expected_url: str
    ) -> None:
        """Test that urljoin is used correctly for URL construction with various base URLs"""
        mock_get.return_value = httpx.Response(200)

        credentials = _credentials(base_url=base_url)
        auth = WatercrawlAuth(credentials)
        auth.validate_credentials()

        # Verify the correct URL was called
        assert mock_get.call_args[0][0] == expected_url

    @patch("services.data_source.auth.watercrawl.watercrawl.httpx.get", autospec=True)
    def test_should_handle_timeout_with_retry_suggestion(
        self, mock_get: MagicMock, auth_instance: WatercrawlAuth
    ) -> None:
        """Test that timeout errors are handled gracefully with appropriate error message"""
        mock_get.side_effect = httpx.TimeoutException("The request timed out after 30 seconds")

        with pytest.raises(httpx.TimeoutException) as exc_info:
            auth_instance.validate_credentials()

        # Verify the timeout exception is raised with original message
        assert "timed out" in str(exc_info.value)
