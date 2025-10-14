from unittest.mock import MagicMock, patch

import httpx
import pytest

from services.auth.jina.jina import JinaAuth


class TestJinaAuth:
    def test_should_initialize_with_valid_bearer_credentials(self):
        """Test successful initialization with valid bearer credentials"""
        credentials = {"auth_type": "bearer", "config": {"api_key": "test_api_key_123"}}
        auth = JinaAuth(credentials)
        assert auth.api_key == "test_api_key_123"
        assert auth.credentials == credentials

    def test_should_raise_error_for_invalid_auth_type(self):
        """Test that non-bearer auth type raises ValueError"""
        credentials = {"auth_type": "basic", "config": {"api_key": "test_api_key_123"}}
        with pytest.raises(ValueError) as exc_info:
            JinaAuth(credentials)
        assert str(exc_info.value) == "Invalid auth type, Jina Reader auth type must be Bearer"

    def test_should_raise_error_for_missing_api_key(self):
        """Test that missing API key raises ValueError"""
        credentials = {"auth_type": "bearer", "config": {}}
        with pytest.raises(ValueError) as exc_info:
            JinaAuth(credentials)
        assert str(exc_info.value) == "No API key provided"

    def test_should_raise_error_for_missing_config(self):
        """Test that missing config section raises ValueError"""
        credentials = {"auth_type": "bearer"}
        with pytest.raises(ValueError) as exc_info:
            JinaAuth(credentials)
        assert str(exc_info.value) == "No API key provided"

    @patch("services.auth.jina.jina.httpx.post")
    def test_should_validate_valid_credentials_successfully(self, mock_post):
        """Test successful credential validation"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_post.return_value = mock_response

        credentials = {"auth_type": "bearer", "config": {"api_key": "test_api_key_123"}}
        auth = JinaAuth(credentials)
        result = auth.validate_credentials()

        assert result is True
        mock_post.assert_called_once_with(
            "https://r.jina.ai",
            headers={"Content-Type": "application/json", "Authorization": "Bearer test_api_key_123"},
            json={"url": "https://example.com"},
        )

    @patch("services.auth.jina.jina.httpx.post")
    def test_should_handle_http_402_error(self, mock_post):
        """Test handling of 402 Payment Required error"""
        mock_response = MagicMock()
        mock_response.status_code = 402
        mock_response.json.return_value = {"error": "Payment required"}
        mock_post.return_value = mock_response

        credentials = {"auth_type": "bearer", "config": {"api_key": "test_api_key_123"}}
        auth = JinaAuth(credentials)

        with pytest.raises(Exception) as exc_info:
            auth.validate_credentials()
        assert str(exc_info.value) == "Failed to authorize. Status code: 402. Error: Payment required"

    @patch("services.auth.jina.jina.httpx.post")
    def test_should_handle_http_409_error(self, mock_post):
        """Test handling of 409 Conflict error"""
        mock_response = MagicMock()
        mock_response.status_code = 409
        mock_response.json.return_value = {"error": "Conflict error"}
        mock_post.return_value = mock_response

        credentials = {"auth_type": "bearer", "config": {"api_key": "test_api_key_123"}}
        auth = JinaAuth(credentials)

        with pytest.raises(Exception) as exc_info:
            auth.validate_credentials()
        assert str(exc_info.value) == "Failed to authorize. Status code: 409. Error: Conflict error"

    @patch("services.auth.jina.jina.httpx.post")
    def test_should_handle_http_500_error(self, mock_post):
        """Test handling of 500 Internal Server Error"""
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.json.return_value = {"error": "Internal server error"}
        mock_post.return_value = mock_response

        credentials = {"auth_type": "bearer", "config": {"api_key": "test_api_key_123"}}
        auth = JinaAuth(credentials)

        with pytest.raises(Exception) as exc_info:
            auth.validate_credentials()
        assert str(exc_info.value) == "Failed to authorize. Status code: 500. Error: Internal server error"

    @patch("services.auth.jina.jina.httpx.post")
    def test_should_handle_unexpected_error_with_text_response(self, mock_post):
        """Test handling of unexpected errors with text response"""
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.text = '{"error": "Forbidden"}'
        mock_response.json.side_effect = Exception("Not JSON")
        mock_post.return_value = mock_response

        credentials = {"auth_type": "bearer", "config": {"api_key": "test_api_key_123"}}
        auth = JinaAuth(credentials)

        with pytest.raises(Exception) as exc_info:
            auth.validate_credentials()
        assert str(exc_info.value) == "Failed to authorize. Status code: 403. Error: Forbidden"

    @patch("services.auth.jina.jina.httpx.post")
    def test_should_handle_unexpected_error_without_text(self, mock_post):
        """Test handling of unexpected errors without text response"""
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.text = ""
        mock_response.json.side_effect = Exception("Not JSON")
        mock_post.return_value = mock_response

        credentials = {"auth_type": "bearer", "config": {"api_key": "test_api_key_123"}}
        auth = JinaAuth(credentials)

        with pytest.raises(Exception) as exc_info:
            auth.validate_credentials()
        assert str(exc_info.value) == "Unexpected error occurred while trying to authorize. Status code: 404"

    @patch("services.auth.jina.jina.httpx.post")
    def test_should_handle_network_errors(self, mock_post):
        """Test handling of network connection errors"""
        mock_post.side_effect = httpx.ConnectError("Network error")

        credentials = {"auth_type": "bearer", "config": {"api_key": "test_api_key_123"}}
        auth = JinaAuth(credentials)

        with pytest.raises(httpx.ConnectError):
            auth.validate_credentials()

    def test_should_not_expose_api_key_in_error_messages(self):
        """Test that API key is not exposed in error messages"""
        credentials = {"auth_type": "bearer", "config": {"api_key": "super_secret_key_12345"}}
        auth = JinaAuth(credentials)

        # Verify API key is stored but not in any error message
        assert auth.api_key == "super_secret_key_12345"

        # Test various error scenarios don't expose the key
        with pytest.raises(ValueError) as exc_info:
            JinaAuth({"auth_type": "basic", "config": {"api_key": "super_secret_key_12345"}})
        assert "super_secret_key_12345" not in str(exc_info.value)
