from unittest.mock import MagicMock, patch

import pytest

from services.auth.api_key_auth_factory import ApiKeyAuthFactory
from services.auth.auth_type import AuthType


class TestApiKeyAuthFactory:
    """Test cases for ApiKeyAuthFactory"""

    @pytest.mark.parametrize(
        ("provider", "auth_class_path"),
        [
            (AuthType.FIRECRAWL, "services.auth.firecrawl.firecrawl.FirecrawlAuth"),
            (AuthType.WATERCRAWL, "services.auth.watercrawl.watercrawl.WatercrawlAuth"),
            (AuthType.JINA, "services.auth.jina.jina.JinaAuth"),
        ],
    )
    def test_get_apikey_auth_factory_valid_providers(self, provider, auth_class_path):
        """Test getting auth factory for all valid providers"""
        with patch(auth_class_path) as mock_auth:
            auth_class = ApiKeyAuthFactory.get_apikey_auth_factory(provider)
            assert auth_class == mock_auth

    @pytest.mark.parametrize(
        "invalid_provider",
        [
            "invalid_provider",
            "",
            None,
            123,
            "UNSUPPORTED",
        ],
    )
    def test_get_apikey_auth_factory_invalid_providers(self, invalid_provider):
        """Test getting auth factory with various invalid providers"""
        with pytest.raises(ValueError) as exc_info:
            ApiKeyAuthFactory.get_apikey_auth_factory(invalid_provider)
        assert str(exc_info.value) == "Invalid provider"

    @pytest.mark.parametrize(
        ("credentials_return_value", "expected_result"),
        [
            (True, True),
            (False, False),
        ],
    )
    @patch("services.auth.api_key_auth_factory.ApiKeyAuthFactory.get_apikey_auth_factory")
    def test_validate_credentials_delegates_to_auth_instance(
        self, mock_get_factory, credentials_return_value, expected_result
    ):
        """Test that validate_credentials delegates to auth instance correctly"""
        # Arrange
        mock_auth_instance = MagicMock()
        mock_auth_instance.validate_credentials.return_value = credentials_return_value
        mock_auth_class = MagicMock(return_value=mock_auth_instance)
        mock_get_factory.return_value = mock_auth_class

        # Act
        factory = ApiKeyAuthFactory(AuthType.FIRECRAWL, {"api_key": "test_key"})
        result = factory.validate_credentials()

        # Assert
        assert result is expected_result
        mock_auth_instance.validate_credentials.assert_called_once()

    @patch("services.auth.api_key_auth_factory.ApiKeyAuthFactory.get_apikey_auth_factory")
    def test_validate_credentials_propagates_exceptions(self, mock_get_factory):
        """Test that exceptions from auth instance are propagated"""
        # Arrange
        mock_auth_instance = MagicMock()
        mock_auth_instance.validate_credentials.side_effect = Exception("Authentication error")
        mock_auth_class = MagicMock(return_value=mock_auth_instance)
        mock_get_factory.return_value = mock_auth_class

        # Act & Assert
        factory = ApiKeyAuthFactory(AuthType.FIRECRAWL, {"api_key": "test_key"})
        with pytest.raises(Exception) as exc_info:
            factory.validate_credentials()
        assert str(exc_info.value) == "Authentication error"
