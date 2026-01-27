"""
Unit tests for Plivo SMS builtin tool provider.

This module tests the Plivo SMS tool provider functionality including:
- Credential validation
- Provider initialization
- Error handling for invalid credentials
"""

from unittest.mock import MagicMock, patch

import pytest


class TestPlivoSmsProviderCredentialValidation:
    """Test Plivo SMS provider credential validation."""

    @patch("core.tools.builtin_tool.providers.plivo_sms.plivo_sms.plivo")
    def test_validate_credentials_success(self, mock_plivo):
        """Test successful credential validation."""
        from core.tools.builtin_tool.providers.plivo_sms.plivo_sms import PlivoSmsProvider

        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client
        mock_client.account.get.return_value = {"account_id": "test_id"}

        provider = PlivoSmsProvider()
        credentials = {
            "auth_id": "test_auth_id",
            "auth_token": "test_auth_token",
        }

        # Should not raise any exception
        provider._validate_credentials(user_id="user-123", credentials=credentials)

        mock_plivo.RestClient.assert_called_once_with(
            auth_id="test_auth_id", auth_token="test_auth_token"
        )
        mock_client.account.get.assert_called_once()

    def test_validate_credentials_missing_auth_id(self):
        """Test credential validation fails when auth_id is missing."""
        from core.tools.builtin_tool.providers.plivo_sms.plivo_sms import PlivoSmsProvider
        from core.tools.errors import ToolProviderCredentialValidationError

        provider = PlivoSmsProvider()
        credentials = {
            "auth_id": "",
            "auth_token": "test_auth_token",
        }

        with pytest.raises(
            ToolProviderCredentialValidationError,
            match="Plivo Auth ID and Auth Token are required",
        ):
            provider._validate_credentials(user_id="user-123", credentials=credentials)

    def test_validate_credentials_missing_auth_token(self):
        """Test credential validation fails when auth_token is missing."""
        from core.tools.builtin_tool.providers.plivo_sms.plivo_sms import PlivoSmsProvider
        from core.tools.errors import ToolProviderCredentialValidationError

        provider = PlivoSmsProvider()
        credentials = {
            "auth_id": "test_auth_id",
            "auth_token": "",
        }

        with pytest.raises(
            ToolProviderCredentialValidationError,
            match="Plivo Auth ID and Auth Token are required",
        ):
            provider._validate_credentials(user_id="user-123", credentials=credentials)

    def test_validate_credentials_both_missing(self):
        """Test credential validation fails when both credentials are missing."""
        from core.tools.builtin_tool.providers.plivo_sms.plivo_sms import PlivoSmsProvider
        from core.tools.errors import ToolProviderCredentialValidationError

        provider = PlivoSmsProvider()
        credentials = {}

        with pytest.raises(
            ToolProviderCredentialValidationError,
            match="Plivo Auth ID and Auth Token are required",
        ):
            provider._validate_credentials(user_id="user-123", credentials=credentials)

    @patch("core.tools.builtin_tool.providers.plivo_sms.plivo_sms.plivo")
    def test_validate_credentials_authentication_error(self, mock_plivo):
        """Test credential validation fails on authentication error."""
        from core.tools.builtin_tool.providers.plivo_sms.plivo_sms import PlivoSmsProvider
        from core.tools.errors import ToolProviderCredentialValidationError

        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client
        mock_plivo.exceptions.AuthenticationError = Exception
        mock_client.account.get.side_effect = mock_plivo.exceptions.AuthenticationError(
            "Invalid credentials"
        )

        provider = PlivoSmsProvider()
        credentials = {
            "auth_id": "invalid_auth_id",
            "auth_token": "invalid_auth_token",
        }

        with pytest.raises(
            ToolProviderCredentialValidationError,
            match="Invalid Plivo Auth ID or Auth Token",
        ):
            provider._validate_credentials(user_id="user-123", credentials=credentials)

    @patch("core.tools.builtin_tool.providers.plivo_sms.plivo_sms.plivo")
    def test_validate_credentials_generic_error(self, mock_plivo):
        """Test credential validation handles generic errors."""
        from core.tools.builtin_tool.providers.plivo_sms.plivo_sms import PlivoSmsProvider
        from core.tools.errors import ToolProviderCredentialValidationError

        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client
        mock_plivo.exceptions.AuthenticationError = type(
            "AuthenticationError", (Exception,), {}
        )
        mock_client.account.get.side_effect = Exception("Network error")

        provider = PlivoSmsProvider()
        credentials = {
            "auth_id": "test_auth_id",
            "auth_token": "test_auth_token",
        }

        with pytest.raises(
            ToolProviderCredentialValidationError,
            match="Failed to validate Plivo credentials",
        ):
            provider._validate_credentials(user_id="user-123", credentials=credentials)
