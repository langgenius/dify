import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from services.auth.firecrawl.firecrawl import FirecrawlAuth


class TestFirecrawlAuth:
    @pytest.fixture
    def valid_credentials(self):
        """Fixture for valid bearer credentials"""
        return {"auth_type": "bearer", "config": {"api_key": "test_api_key_123"}}

    @pytest.fixture
    def auth_instance(self, valid_credentials):
        """Fixture for FirecrawlAuth instance with valid credentials"""
        return FirecrawlAuth(valid_credentials)

    def test_should_initialize_with_valid_bearer_credentials(self, valid_credentials):
        """Test successful initialization with valid bearer credentials"""
        auth = FirecrawlAuth(valid_credentials)
        assert auth.api_key == "test_api_key_123"
        assert auth.base_url == "https://api.firecrawl.dev"
        assert auth.credentials == valid_credentials

    def test_should_initialize_with_custom_base_url(self):
        """Test initialization with custom base URL"""
        credentials = {
            "auth_type": "bearer",
            "config": {"api_key": "test_api_key_123", "base_url": "https://custom.firecrawl.dev"},
        }
        auth = FirecrawlAuth(credentials)
        assert auth.api_key == "test_api_key_123"
        assert auth.base_url == "https://custom.firecrawl.dev"

    @pytest.mark.parametrize(
        ("auth_type", "expected_error"),
        [
            ("basic", "Invalid auth type, Firecrawl auth type must be Bearer"),
            ("x-api-key", "Invalid auth type, Firecrawl auth type must be Bearer"),
            ("", "Invalid auth type, Firecrawl auth type must be Bearer"),
        ],
    )
    def test_should_raise_error_for_invalid_auth_type(self, auth_type, expected_error):
        """Test that non-bearer auth types raise ValueError"""
        credentials = {"auth_type": auth_type, "config": {"api_key": "test_api_key_123"}}
        with pytest.raises(ValueError) as exc_info:
            FirecrawlAuth(credentials)
        assert str(exc_info.value) == expected_error

    @pytest.mark.parametrize(
        ("credentials", "expected_error"),
        [
            ({"auth_type": "bearer", "config": {}}, "No API key provided"),
            ({"auth_type": "bearer"}, "No API key provided"),
            ({"auth_type": "bearer", "config": {"api_key": ""}}, "No API key provided"),
            ({"auth_type": "bearer", "config": {"api_key": None}}, "No API key provided"),
        ],
    )
    def test_should_raise_error_for_missing_api_key(self, credentials, expected_error):
        """Test that missing or empty API key raises ValueError"""
        with pytest.raises(ValueError) as exc_info:
            FirecrawlAuth(credentials)
        assert str(exc_info.value) == expected_error

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_should_validate_valid_credentials_successfully(self, mock_post, auth_instance):
        """Test successful credential validation"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_post.return_value = mock_response

        result = auth_instance.validate_credentials()

        assert result is True
        expected_data = {
            "url": "https://example.com",
            "includePaths": [],
            "excludePaths": [],
            "limit": 1,
            "scrapeOptions": {"onlyMainContent": True},
        }
        mock_post.assert_called_once_with(
            "https://api.firecrawl.dev/v1/crawl",
            headers={"Content-Type": "application/json", "Authorization": "Bearer test_api_key_123"},
            json=expected_data,
        )

    @pytest.mark.parametrize(
        ("status_code", "error_message"),
        [
            (402, "Payment required"),
            (409, "Conflict error"),
            (500, "Internal server error"),
        ],
    )
    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_should_handle_http_errors(self, mock_post, status_code, error_message, auth_instance):
        """Test handling of various HTTP error codes"""
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_response.json.return_value = {"error": error_message}
        mock_post.return_value = mock_response

        with pytest.raises(Exception) as exc_info:
            auth_instance.validate_credentials()
        assert str(exc_info.value) == f"Failed to authorize. Status code: {status_code}. Error: {error_message}"

    @pytest.mark.parametrize(
        ("status_code", "response_text", "has_json_error", "expected_error_contains"),
        [
            (403, '{"error": "Forbidden"}', False, "Failed to authorize. Status code: 403. Error: Forbidden"),
            # empty body falls back to generic message
            (404, "", True, "Failed to authorize. Status code: 404. Error: Unknown error occurred"),
            # non-JSON body is surfaced directly
            (401, "Not JSON", True, "Failed to authorize. Status code: 401. Error: Not JSON"),
        ],
    )
    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_should_handle_unexpected_errors(
        self, mock_post, status_code, response_text, has_json_error, expected_error_contains, auth_instance
    ):
        """Test handling of unexpected errors with various response formats"""
        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_response.text = response_text
        if has_json_error:
            mock_response.json.side_effect = json.JSONDecodeError("Not JSON", "", 0)
        else:
            mock_response.json.return_value = {"error": "Forbidden"}
        mock_post.return_value = mock_response

        with pytest.raises(Exception) as exc_info:
            auth_instance.validate_credentials()
        assert str(exc_info.value) == expected_error_contains

    @pytest.mark.parametrize(
        ("exception_type", "exception_message"),
        [
            (httpx.ConnectError, "Network error"),
            (httpx.TimeoutException, "Request timeout"),
            (httpx.ReadTimeout, "Read timeout"),
            (httpx.ConnectTimeout, "Connection timeout"),
        ],
    )
    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_should_handle_network_errors(self, mock_post, exception_type, exception_message, auth_instance):
        """Test handling of various network-related errors including timeouts"""
        mock_post.side_effect = exception_type(exception_message)

        with pytest.raises(exception_type) as exc_info:
            auth_instance.validate_credentials()
        assert exception_message in str(exc_info.value)

    def test_should_not_expose_api_key_in_error_messages(self):
        """Test that API key is not exposed in error messages"""
        credentials = {"auth_type": "bearer", "config": {"api_key": "super_secret_key_12345"}}
        auth = FirecrawlAuth(credentials)

        # Verify API key is stored but not in any error message
        assert auth.api_key == "super_secret_key_12345"

        # Test various error scenarios don't expose the key
        with pytest.raises(ValueError) as exc_info:
            FirecrawlAuth({"auth_type": "basic", "config": {"api_key": "super_secret_key_12345"}})
        assert "super_secret_key_12345" not in str(exc_info.value)

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_should_use_custom_base_url_in_validation(self, mock_post):
        """Test that custom base URL is used in validation and normalized"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_post.return_value = mock_response

        for base in ("https://custom.firecrawl.dev", "https://custom.firecrawl.dev/"):
            credentials = {
                "auth_type": "bearer",
                "config": {"api_key": "test_api_key_123", "base_url": base},
            }
            auth = FirecrawlAuth(credentials)
            result = auth.validate_credentials()

            assert result is True
            assert mock_post.call_args[0][0] == "https://custom.firecrawl.dev/v1/crawl"

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_should_handle_timeout_with_retry_suggestion(self, mock_post, auth_instance):
        """Test that timeout errors are handled gracefully with appropriate error message"""
        mock_post.side_effect = httpx.TimeoutException("The request timed out after 30 seconds")

        with pytest.raises(httpx.TimeoutException) as exc_info:
            auth_instance.validate_credentials()

        # Verify the timeout exception is raised with original message
        assert "timed out" in str(exc_info.value)
