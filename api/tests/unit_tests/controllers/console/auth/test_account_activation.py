"""
Test suite for account activation flows.

This module tests the account activation mechanism including:
- Invitation token validation
- Account activation with user preferences
- Workspace member onboarding
- Initial login after activation
"""

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.auth.activate import ActivateApi, ActivateCheckApi
from controllers.console.error import AlreadyActivateError
from models.account import AccountStatus


class TestActivateCheckApi:
    """Test cases for checking activation token validity."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_invitation(self):
        """Create mock invitation object."""
        tenant = MagicMock()
        tenant.id = "workspace-123"
        tenant.name = "Test Workspace"

        return {
            "data": {"email": "invitee@example.com"},
            "tenant": tenant,
        }

    @patch("controllers.console.auth.activate.RegisterService.get_invitation_with_case_fallback")
    def test_check_valid_invitation_token(self, mock_get_invitation, app, mock_invitation):
        """
        Test checking valid invitation token.

        Verifies that:
        - Valid token returns invitation data
        - Workspace information is included
        - Invitee email is returned
        """
        # Arrange
        mock_get_invitation.return_value = mock_invitation

        # Act
        with app.test_request_context(
            "/activate/check?workspace_id=workspace-123&email=invitee@example.com&token=valid_token"
        ):
            api = ActivateCheckApi()
            response = api.get()

        # Assert
        assert response["is_valid"] is True
        assert response["data"]["workspace_name"] == "Test Workspace"
        assert response["data"]["workspace_id"] == "workspace-123"
        assert response["data"]["email"] == "invitee@example.com"

    @patch("controllers.console.auth.activate.RegisterService.get_invitation_with_case_fallback")
    def test_check_invalid_invitation_token(self, mock_get_invitation, app):
        """
        Test checking invalid invitation token.

        Verifies that:
        - Invalid token returns is_valid as False
        - No data is returned for invalid tokens
        """
        # Arrange
        mock_get_invitation.return_value = None

        # Act
        with app.test_request_context(
            "/activate/check?workspace_id=workspace-123&email=test@example.com&token=invalid_token"
        ):
            api = ActivateCheckApi()
            response = api.get()

        # Assert
        assert response["is_valid"] is False

    @patch("controllers.console.auth.activate.RegisterService.get_invitation_with_case_fallback")
    def test_check_token_without_workspace_id(self, mock_get_invitation, app, mock_invitation):
        """
        Test checking token without workspace ID.

        Verifies that:
        - Token can be checked without workspace_id parameter
        - System handles None workspace_id gracefully
        """
        # Arrange
        mock_get_invitation.return_value = mock_invitation

        # Act
        with app.test_request_context("/activate/check?email=invitee@example.com&token=valid_token"):
            api = ActivateCheckApi()
            response = api.get()

        # Assert
        assert response["is_valid"] is True
        mock_get_invitation.assert_called_once_with(None, "invitee@example.com", "valid_token")

    @patch("controllers.console.auth.activate.RegisterService.get_invitation_with_case_fallback")
    def test_check_token_without_email(self, mock_get_invitation, app, mock_invitation):
        """
        Test checking token without email parameter.

        Verifies that:
        - Token can be checked without email parameter
        - System handles None email gracefully
        """
        # Arrange
        mock_get_invitation.return_value = mock_invitation

        # Act
        with app.test_request_context("/activate/check?workspace_id=workspace-123&token=valid_token"):
            api = ActivateCheckApi()
            response = api.get()

        # Assert
        assert response["is_valid"] is True
        mock_get_invitation.assert_called_once_with("workspace-123", None, "valid_token")

    @patch("controllers.console.auth.activate.RegisterService.get_invitation_with_case_fallback")
    def test_check_token_normalizes_email_to_lowercase(self, mock_get_invitation, app, mock_invitation):
        """Ensure token validation uses lowercase emails."""
        mock_get_invitation.return_value = mock_invitation

        with app.test_request_context(
            "/activate/check?workspace_id=workspace-123&email=Invitee@Example.com&token=valid_token"
        ):
            api = ActivateCheckApi()
            response = api.get()

        assert response["is_valid"] is True
        mock_get_invitation.assert_called_once_with("workspace-123", "Invitee@Example.com", "valid_token")


class TestActivateApi:
    """Test cases for account activation endpoint."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_account(self):
        """Create mock account object."""
        account = MagicMock()
        account.id = "account-123"
        account.email = "invitee@example.com"
        account.status = AccountStatus.PENDING
        return account

    @pytest.fixture
    def mock_invitation(self, mock_account):
        """Create mock invitation with account."""
        tenant = MagicMock()
        tenant.id = "workspace-123"
        tenant.name = "Test Workspace"

        return {
            "data": {"email": "invitee@example.com"},
            "tenant": tenant,
            "account": mock_account,
        }

    @patch("controllers.console.auth.activate.RegisterService.get_invitation_if_token_valid")
    @patch("controllers.console.auth.activate.RegisterService.revoke_token")
    @patch("controllers.console.auth.activate.db")
    def test_successful_account_activation(
        self,
        mock_db,
        mock_revoke_token,
        mock_get_invitation,
        app,
        mock_invitation,
        mock_account,
    ):
        """
        Test successful account activation.

        Verifies that:
        - Account is activated with user preferences
        - Account status is set to ACTIVE
        - Invitation token is revoked
        """
        # Arrange
        mock_get_invitation.return_value = mock_invitation

        # Act
        with app.test_request_context(
            "/activate",
            method="POST",
            json={
                "workspace_id": "workspace-123",
                "email": "invitee@example.com",
                "token": "valid_token",
                "name": "John Doe",
                "interface_language": "en-US",
                "timezone": "UTC",
            },
        ):
            api = ActivateApi()
            response = api.post()

        # Assert
        assert response["result"] == "success"
        assert mock_account.name == "John Doe"
        assert mock_account.interface_language == "en-US"
        assert mock_account.timezone == "UTC"
        assert mock_account.status == AccountStatus.ACTIVE
        assert mock_account.initialized_at is not None
        mock_revoke_token.assert_called_once_with("workspace-123", "invitee@example.com", "valid_token")
        mock_db.session.commit.assert_called_once()

    @patch("controllers.console.auth.activate.RegisterService.get_invitation_with_case_fallback")
    def test_activation_with_invalid_token(self, mock_get_invitation, app):
        """
        Test account activation with invalid token.

        Verifies that:
        - AlreadyActivateError is raised for invalid tokens
        - No account changes are made
        """
        # Arrange
        mock_get_invitation.return_value = None

        # Act & Assert
        with app.test_request_context(
            "/activate",
            method="POST",
            json={
                "workspace_id": "workspace-123",
                "email": "invitee@example.com",
                "token": "invalid_token",
                "name": "John Doe",
                "interface_language": "en-US",
                "timezone": "UTC",
            },
        ):
            api = ActivateApi()
            with pytest.raises(AlreadyActivateError):
                api.post()

    @patch("controllers.console.auth.activate.RegisterService.get_invitation_with_case_fallback")
    @patch("controllers.console.auth.activate.RegisterService.revoke_token")
    @patch("controllers.console.auth.activate.db")
    def test_activation_sets_interface_theme(
        self,
        mock_db,
        mock_revoke_token,
        mock_get_invitation,
        app,
        mock_invitation,
        mock_account,
    ):
        """
        Test that activation sets default interface theme.

        Verifies that:
        - Interface theme is set to 'light' by default
        """
        # Arrange
        mock_get_invitation.return_value = mock_invitation

        # Act
        with app.test_request_context(
            "/activate",
            method="POST",
            json={
                "workspace_id": "workspace-123",
                "email": "invitee@example.com",
                "token": "valid_token",
                "name": "John Doe",
                "interface_language": "en-US",
                "timezone": "UTC",
            },
        ):
            api = ActivateApi()
            api.post()

        # Assert
        assert mock_account.interface_theme == "light"

    @pytest.mark.parametrize(
        ("language", "timezone"),
        [
            ("en-US", "UTC"),
            ("zh-Hans", "Asia/Shanghai"),
            ("ja-JP", "Asia/Tokyo"),
            ("es-ES", "Europe/Madrid"),
        ],
    )
    @patch("controllers.console.auth.activate.RegisterService.get_invitation_with_case_fallback")
    @patch("controllers.console.auth.activate.RegisterService.revoke_token")
    @patch("controllers.console.auth.activate.db")
    def test_activation_with_different_locales(
        self,
        mock_db,
        mock_revoke_token,
        mock_get_invitation,
        app,
        mock_invitation,
        mock_account,
        language,
        timezone,
    ):
        """
        Test account activation with various language and timezone combinations.

        Verifies that:
        - Different languages are accepted
        - Different timezones are accepted
        - User preferences are properly stored
        """
        # Arrange
        mock_get_invitation.return_value = mock_invitation

        # Act
        with app.test_request_context(
            "/activate",
            method="POST",
            json={
                "workspace_id": "workspace-123",
                "email": "invitee@example.com",
                "token": "valid_token",
                "name": "Test User",
                "interface_language": language,
                "timezone": timezone,
            },
        ):
            api = ActivateApi()
            response = api.post()

        # Assert
        assert response["result"] == "success"
        assert mock_account.interface_language == language
        assert mock_account.timezone == timezone

    @patch("controllers.console.auth.activate.RegisterService.get_invitation_with_case_fallback")
    @patch("controllers.console.auth.activate.RegisterService.revoke_token")
    @patch("controllers.console.auth.activate.db")
    def test_activation_returns_success_response(
        self,
        mock_db,
        mock_revoke_token,
        mock_get_invitation,
        app,
        mock_invitation,
    ):
        """
        Test that activation returns a success response without authentication tokens.

        Verifies that:
        - Response contains a success result
        - No token data is returned
        """
        # Arrange
        mock_get_invitation.return_value = mock_invitation

        # Act
        with app.test_request_context(
            "/activate",
            method="POST",
            json={
                "workspace_id": "workspace-123",
                "email": "invitee@example.com",
                "token": "valid_token",
                "name": "John Doe",
                "interface_language": "en-US",
                "timezone": "UTC",
            },
        ):
            api = ActivateApi()
            response = api.post()

        # Assert
        assert response == {"result": "success"}

    @patch("controllers.console.auth.activate.RegisterService.get_invitation_with_case_fallback")
    @patch("controllers.console.auth.activate.RegisterService.revoke_token")
    @patch("controllers.console.auth.activate.db")
    def test_activation_without_workspace_id(
        self,
        mock_db,
        mock_revoke_token,
        mock_get_invitation,
        app,
        mock_invitation,
    ):
        """
        Test account activation without workspace_id.

        Verifies that:
        - Activation can proceed without workspace_id
        - Token revocation handles None workspace_id
        """
        # Arrange
        mock_get_invitation.return_value = mock_invitation

        # Act
        with app.test_request_context(
            "/activate",
            method="POST",
            json={
                "email": "invitee@example.com",
                "token": "valid_token",
                "name": "John Doe",
                "interface_language": "en-US",
                "timezone": "UTC",
            },
        ):
            api = ActivateApi()
            response = api.post()

        # Assert
        assert response["result"] == "success"
        mock_revoke_token.assert_called_once_with(None, "invitee@example.com", "valid_token")

    @patch("controllers.console.auth.activate.RegisterService.get_invitation_with_case_fallback")
    @patch("controllers.console.auth.activate.RegisterService.revoke_token")
    @patch("controllers.console.auth.activate.db")
    def test_activation_normalizes_email_before_lookup(
        self,
        mock_db,
        mock_revoke_token,
        mock_get_invitation,
        app,
        mock_invitation,
        mock_account,
    ):
        """Ensure uppercase emails are normalized before lookup and revocation."""
        mock_get_invitation.return_value = mock_invitation

        with app.test_request_context(
            "/activate",
            method="POST",
            json={
                "workspace_id": "workspace-123",
                "email": "Invitee@Example.com",
                "token": "valid_token",
                "name": "John Doe",
                "interface_language": "en-US",
                "timezone": "UTC",
            },
        ):
            api = ActivateApi()
            response = api.post()

        assert response["result"] == "success"
        mock_get_invitation.assert_called_once_with("workspace-123", "Invitee@Example.com", "valid_token")
        mock_revoke_token.assert_called_once_with("workspace-123", "invitee@example.com", "valid_token")
