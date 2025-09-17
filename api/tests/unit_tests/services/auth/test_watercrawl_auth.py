from unittest.mock import MagicMock, patch

import httpx
import pytest

from services.auth.watercrawl.watercrawl import WatercrawlAuth


class TestWatercrawlAuth:
    @pytest.fixture
    def valid_credentials(self):
        """Fixture for valid x-api-key credentials"""
        return {"auth_type": "x-api-key", "config": {"api_key": "test_api_key_123"}}

    @pytest.fixture
    def auth_instance(self, valid_credentials):
        """Fixture for WatercrawlAuth instance with valid credentials"""
        return WatercrawlAuth(valid_credentials)

    def test_should_initialize_with_valid_x_api_key_credentials(self, valid_credentials):
        """Test successful initialization with valid x-api-key credentials"""
        auth = WatercrawlAuth(valid_credentials)
        assert auth.api_key == "test_api_key_123"
        assert auth.base_url == "https://app.watercrawl.dev"
        assert auth.credentials == valid_credentials

    def test_should_initialize_with_custom_base_url(self):
        """Test initialization with custom base URL"""
        credentials = {
            "auth_type": "x-api-key",
            "config": {"api_key": "test_api_key_123", "base_url": "https://custom.watercrawl.dev"},
        }
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
    def test_should_raise_error_for_invalid_auth_type(self, auth_type, expected_error):
        """Test that non-x-api-key auth types raise ValueError"""
        credentials = {"auth_type": auth_type, "config": {"api_key": "test_api_key_123"}}
        with pytest.raises(ValueError) as exc_info:
            WatercrawlAuth(credentials)
        assert str(exc_info.value) == expected_error

    @pytest.mark.parametrize(
        ("credentials", "expected_error"),
        [
            ({"auth_type": "x-api-key", "config": {}}, "No API key provided"),
            ({"auth_type": "x-api-key"}, "No API key provided"),
            ({"auth_type": "x-api-key", "config": {"api_key": ""}}, "No API key provided"),
            ({"auth_type": "x-api-key", "config": {"api_key": None}}, "No API key provided"),
        ],
    )
    def test_should_raise_error_for_missing_api_key(self, credentials, expected_error):
        """Test that missing or empty API key raises ValueError"""
        with pytest.raises(ValueError) as exc_info:
            WatercrawlAuth(credentials)
        assert str(exc_info.value) == expected_error

    @patch("services.auth.watercrawl.watercrawl.httpx.get")
    def test_should_validate_valid_credentials_successfully(self, mock_get, auth_instance):
        """Test successful credential validation"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        result = auth_instance.validate_credentials()

        assert result is True
        mock_get.assert_called_once_with(
            "https://app.watercrawl.dev/api/v1/core/crawl-requests/",
            headers={"Content-Type": "application/json", "X-API-KEY": "test_api_key_123"},
        )

    @pytest.mark.parametrize(
        ("status_code", "error_message"),
        [
            (402, "Payment required"),
            (409, "Conflict error"),
            (500, "Internal server error"),
        ],
    )
    @patch("services.auth.watercrawl.watercrawl.httpx.get")
    def test_should_handle_http_errors(self, mock_get, status_code, error_message, auth_instance):
        """Test handling of various HTTP error codes"""
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_response.json.return_value = {"error": error_message}
        mock_get.return_value = mock_response

        with pytest.raises(Exception) as exc_info:
            auth_instance.validate_credentials()
        assert str(exc_info.value) == f"Failed to authorize. Status code: {status_code}. Error: {error_message}"

    @pytest.mark.parametrize(
        ("status_code", "response_text", "has_json_error", "expected_error_contains"),
        [
            (403, '{"error": "Forbidden"}', True, "Failed to authorize. Status code: 403. Error: Forbidden"),
            (404, "", True, "Unexpected error occurred while trying to authorize. Status code: 404"),
            (401, "Not JSON", True, "Expecting value"),  # JSON decode error
        ],
    )
    @patch("services.auth.watercrawl.watercrawl.httpx.get")
    def test_should_handle_unexpected_errors(
        self, mock_get, status_code, response_text, has_json_error, expected_error_contains, auth_instance
    ):
        """Test handling of unexpected errors with various response formats"""
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_response.text = response_text
        if has_json_error:
            mock_response.json.side_effect = Exception("Not JSON")
        mock_get.return_value = mock_response

        with pytest.raises(Exception) as exc_info:
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
    @patch("services.auth.watercrawl.watercrawl.httpx.get")
    def test_should_handle_network_errors(self, mock_get, exception_type, exception_message, auth_instance):
        """Test handling of various network-related errors including timeouts"""
        mock_get.side_effect = exception_type(exception_message)

        with pytest.raises(exception_type) as exc_info:
            auth_instance.validate_credentials()
        assert exception_message in str(exc_info.value)

    def test_should_not_expose_api_key_in_error_messages(self):
        """Test that API key is not exposed in error messages"""
        credentials = {"auth_type": "x-api-key", "config": {"api_key": "super_secret_key_12345"}}
        auth = WatercrawlAuth(credentials)

        # Verify API key is stored but not in any error message
        assert auth.api_key == "super_secret_key_12345"

        # Test various error scenarios don't expose the key
        with pytest.raises(ValueError) as exc_info:
            WatercrawlAuth({"auth_type": "bearer", "config": {"api_key": "super_secret_key_12345"}})
        assert "super_secret_key_12345" not in str(exc_info.value)

    @patch("services.auth.watercrawl.watercrawl.httpx.get")
    def test_should_use_custom_base_url_in_validation(self, mock_get):
        """Test that custom base URL is used in validation"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        credentials = {
            "auth_type": "x-api-key",
            "config": {"api_key": "test_api_key_123", "base_url": "https://custom.watercrawl.dev"},
        }
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
    @patch("services.auth.watercrawl.watercrawl.httpx.get")
    def test_should_use_urljoin_for_url_construction(self, mock_get, base_url, expected_url):
        """Test that urljoin is used correctly for URL construction with various base URLs"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_get.return_value = mock_response

        credentials = {"auth_type": "x-api-key", "config": {"api_key": "test_api_key_123", "base_url": base_url}}
        auth = WatercrawlAuth(credentials)
        auth.validate_credentials()

        # Verify the correct URL was called
        assert mock_get.call_args[0][0] == expected_url

    @patch("services.auth.watercrawl.watercrawl.httpx.get")
    def test_should_handle_timeout_with_retry_suggestion(self, mock_get, auth_instance):
        """Test that timeout errors are handled gracefully with appropriate error message"""
        mock_get.side_effect = httpx.TimeoutException("The request timed out after 30 seconds")

        with pytest.raises(httpx.TimeoutException) as exc_info:
            auth_instance.validate_credentials()

        # Verify the timeout exception is raised with original message
        assert "timed out" in str(exc_info.value)
