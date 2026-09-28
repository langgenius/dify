import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from services.auth.errors import (
    DataSourceApiKeyAuthCredentialValidationError,
    DataSourceApiKeyAuthProviderUnavailableError,
    InvalidDataSourceApiKeyAuthCredentialsError,
)
from services.auth.jina.jina import JinaAuth
from services.entities.data_source_api_key_auth_entities import DataSourceApiKeyAuthCredentials


def _credentials(
    auth_type: str = "bearer",
    api_key: str = "test_api_key_123",
) -> DataSourceApiKeyAuthCredentials:
    return DataSourceApiKeyAuthCredentials(auth_type, api_key, {})


class TestJinaAuth:
    def test_should_initialize_with_valid_bearer_credentials(self):
        """Test successful initialization with valid bearer credentials"""
        credentials = _credentials()
        auth = JinaAuth(credentials)
        assert auth.api_key == "test_api_key_123"

    def test_should_raise_error_for_invalid_auth_type(self):
        """Test that non-bearer auth type raises a credential error."""
        credentials = _credentials(auth_type="basic")
        with pytest.raises(InvalidDataSourceApiKeyAuthCredentialsError) as exc_info:
            JinaAuth(credentials)
        assert str(exc_info.value) == "Invalid auth type, Jina Reader auth type must be Bearer"

    def test_should_raise_error_for_missing_api_key(self):
        """Test that an empty API key raises a credential error."""
        credentials = _credentials(api_key="")
        with pytest.raises(InvalidDataSourceApiKeyAuthCredentialsError) as exc_info:
            JinaAuth(credentials)
        assert str(exc_info.value) == "No API key provided"

    @patch("services.auth.jina.jina._http_client.post", autospec=True)
    def test_should_validate_valid_credentials_successfully(self, mock_post: MagicMock):
        """Test successful credential validation"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_post.return_value = mock_response

        credentials = _credentials()
        auth = JinaAuth(credentials)
        result = auth.validate_credentials()

        assert result is True
        mock_post.assert_called_once_with(
            "https://r.jina.ai",
            headers={"Content-Type": "application/json", "Authorization": "Bearer test_api_key_123"},
            json={"url": "https://example.com"},
        )

    @patch("services.auth.jina.jina._http_client.post", autospec=True)
    def test_should_handle_http_402_error(self, mock_post: MagicMock):
        """Test handling of 402 Payment Required error"""
        mock_response = MagicMock()
        mock_response.status_code = 402
        mock_response.json.return_value = {"error": "Payment required"}
        mock_post.return_value = mock_response

        credentials = _credentials()
        auth = JinaAuth(credentials)

        with pytest.raises(DataSourceApiKeyAuthCredentialValidationError) as exc_info:
            auth.validate_credentials()
        assert str(exc_info.value) == "Failed to authorize. Status code: 402. Error: Payment required"

    @patch("services.auth.jina.jina._http_client.post", autospec=True)
    def test_should_handle_http_error_with_non_json_text_response(self, mock_post):
        """Test handling of known HTTP errors with non-JSON text response."""
        mock_response = MagicMock()
        mock_response.status_code = 402
        mock_response.text = "Payment required"
        mock_response.json.side_effect = json.JSONDecodeError("Not JSON", "", 0)
        mock_post.return_value = mock_response

        credentials = _credentials()
        auth = JinaAuth(credentials)

        with pytest.raises(DataSourceApiKeyAuthCredentialValidationError) as exc_info:
            auth.validate_credentials()
        assert str(exc_info.value) == "Failed to authorize. Status code: 402. Error: Payment required"

    @patch("services.auth.jina.jina._http_client.post", autospec=True)
    def test_should_handle_http_409_error(self, mock_post):
        """Test handling of 409 Conflict error"""
        mock_response = MagicMock()
        mock_response.status_code = 409
        mock_response.json.return_value = {"error": "Conflict error"}
        mock_post.return_value = mock_response

        credentials = _credentials()
        auth = JinaAuth(credentials)

        with pytest.raises(DataSourceApiKeyAuthCredentialValidationError) as exc_info:
            auth.validate_credentials()
        assert str(exc_info.value) == "Failed to authorize. Status code: 409. Error: Conflict error"

    @pytest.mark.parametrize("status_code", [429, 500, 502, 503])
    @patch("services.auth.jina.jina._http_client.post", autospec=True)
    def test_should_map_upstream_failure_to_provider_unavailable(
        self,
        mock_post: MagicMock,
        status_code: int,
    ):
        mock_response = MagicMock(status_code=status_code)
        mock_post.return_value = mock_response

        auth = JinaAuth(_credentials())

        with pytest.raises(DataSourceApiKeyAuthProviderUnavailableError) as exc_info:
            auth.validate_credentials()

        assert exc_info.value.provider == "jinareader"
        assert exc_info.value.status_code == status_code

    @patch("services.auth.jina.jina._http_client.post", autospec=True)
    def test_should_handle_unexpected_error_with_text_response(self, mock_post: MagicMock):
        """Test handling of unexpected errors with text response"""
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.text = '{"error": "Forbidden"}'
        mock_response.json.side_effect = json.JSONDecodeError("Not JSON", "", 0)
        mock_post.return_value = mock_response

        credentials = _credentials()
        auth = JinaAuth(credentials)

        with pytest.raises(DataSourceApiKeyAuthCredentialValidationError) as exc_info:
            auth.validate_credentials()
        assert str(exc_info.value) == "Failed to authorize. Status code: 403. Error: Forbidden"

    @patch("services.auth.jina.jina._http_client.post", autospec=True)
    def test_should_handle_unexpected_error_with_non_json_text_response(self, mock_post):
        """Test handling of unexpected errors with non-JSON text response."""
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.text = "Forbidden"
        mock_response.json.side_effect = json.JSONDecodeError("Not JSON", "", 0)
        mock_post.return_value = mock_response

        credentials = _credentials()
        auth = JinaAuth(credentials)

        with pytest.raises(DataSourceApiKeyAuthCredentialValidationError) as exc_info:
            auth.validate_credentials()
        assert str(exc_info.value) == "Failed to authorize. Status code: 403. Error: Forbidden"

    @patch("services.auth.jina.jina._http_client.post", autospec=True)
    def test_should_handle_unexpected_error_without_text(self, mock_post):
        """Test handling of unexpected errors without text response"""
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.text = ""
        mock_response.json.side_effect = json.JSONDecodeError("Not JSON", "", 0)
        mock_post.return_value = mock_response

        credentials = _credentials()
        auth = JinaAuth(credentials)

        with pytest.raises(DataSourceApiKeyAuthCredentialValidationError) as exc_info:
            auth.validate_credentials()
        assert str(exc_info.value) == "Unexpected error occurred while trying to authorize. Status code: 404"

    @patch("services.auth.jina.jina._http_client.post", autospec=True)
    def test_should_handle_network_errors(self, mock_post: MagicMock):
        """Test handling of network connection errors"""
        mock_post.side_effect = httpx.ConnectError("Network error")

        credentials = _credentials()
        auth = JinaAuth(credentials)

        with pytest.raises(httpx.ConnectError):
            auth.validate_credentials()

    def test_should_not_expose_api_key_in_error_messages(self):
        """Test that API key is not exposed in error messages"""
        credentials = _credentials(api_key="super_secret_key_12345")
        auth = JinaAuth(credentials)

        # Verify API key is stored but not in any error message
        assert auth.api_key == "super_secret_key_12345"

        # Test various error scenarios don't expose the key
        with pytest.raises(InvalidDataSourceApiKeyAuthCredentialsError) as exc_info:
            JinaAuth(_credentials(auth_type="basic", api_key="super_secret_key_12345"))
        assert "super_secret_key_12345" not in str(exc_info.value)
