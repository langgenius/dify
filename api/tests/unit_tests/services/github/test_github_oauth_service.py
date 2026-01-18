"""
Unit tests for GitHubOAuthService.

This test suite covers:
- OAuth authorization URL generation
- OAuth callback handling
- Token exchange
- Connection management
"""

from unittest.mock import MagicMock, patch

import pytest

from models.github_connection import GitHubConnection
from services.github.github_oauth_service import GitHubOAuthService, OAuthResult
from services.plugin.oauth_service import OAuthProxyService


class TestGitHubOAuthService:
    """Test suite for GitHubOAuthService."""

    @pytest.fixture
    def mock_config(self):
        """Mock Dify config with GitHub OAuth settings."""
        with patch("services.github.github_oauth_service.dify_config") as mock_config:
            mock_config.GITHUB_CLIENT_ID = "test_client_id"
            mock_config.GITHUB_CLIENT_SECRET = "test_client_secret"
            mock_config.CONSOLE_WEB_URL = "http://localhost:3000"
            yield mock_config

    @pytest.fixture
    def mock_redis(self):
        """Mock Redis client."""
        with patch("services.github.github_oauth_service.redis_client") as mock_redis:
            mock_redis.get.return_value = None
            mock_redis.setex.return_value = True
            mock_redis.delete.return_value = True
            yield mock_redis

    @pytest.fixture
    def mock_db(self):
        """Mock database session."""
        with patch("services.github.github_oauth_service.db") as mock_db:
            mock_db.session = MagicMock()
            yield mock_db

    def test_get_authorization_url_success(self, mock_config, mock_redis):
        """Test successful authorization URL generation."""
        tenant_id = "tenant-123"
        user_id = "user-456"
        app_id = "app-789"

        with patch.object(OAuthProxyService, "create_proxy_context", return_value="test-state-123"):
            auth_url, state = GitHubOAuthService.get_authorization_url(
                tenant_id=tenant_id,
                user_id=user_id,
                app_id=app_id,
            )

            assert "github.com/login/oauth/authorize" in auth_url
            assert "client_id=test_client_id" in auth_url
            assert "state=test-state-123" in auth_url
            assert "scope=repo" in auth_url
            assert state == "test-state-123"

    def test_get_authorization_url_missing_config(self):
        """Test authorization URL generation fails when config is missing."""
        with patch("services.github.github_oauth_service.dify_config") as mock_config:
            mock_config.GITHUB_CLIENT_ID = None

            with pytest.raises(ValueError, match="GitHub OAuth is not configured"):
                GitHubOAuthService.get_authorization_url(
                    tenant_id="tenant-123",
                    user_id="user-456",
                )

    def test_handle_callback_success(self, mock_config, mock_redis, mock_db):
        """Test successful OAuth callback handling."""
        import json

        code = "test-code-123"
        state = "test-state-123"

        # Mock OAuth proxy context
        context_data = {
            "tenant_id": "tenant-123",
            "user_id": "user-456",
            "app_id": "app-789",
            "plugin_id": "github",
            "provider": "github",
        }

        # Mock token exchange response
        token_response = {
            "access_token": "gho_test_token_123",
            "token_type": "bearer",
            "scope": "repo",
            "expires_in": 3600,
        }

        # Mock user info response
        user_info = {
            "login": "testuser",
            "id": 12345,
            "name": "Test User",
        }

        # Mock Redis operations
        mock_redis.setex = MagicMock(return_value=True)

        with (
            patch.object(OAuthProxyService, "use_proxy_context", return_value=context_data),
            patch("services.github.github_oauth_service.make_request") as mock_request,
        ):
            # First call: token exchange
            # Second call: user info
            mock_request.side_effect = [
                MagicMock(
                    status_code=200,
                    json=lambda: token_response,
                    raise_for_status=MagicMock(),
                ),
                MagicMock(
                    status_code=200,
                    json=lambda: user_info,
                    raise_for_status=MagicMock(),
                ),
            ]

            result = GitHubOAuthService.handle_callback(code=code, state=state)

            # Verify OAuthResult is returned
            assert isinstance(result, OAuthResult)
            assert result.oauth_state == state
            assert result.repository_owner == "testuser"
            assert result.app_id == "app-789"

            # Verify token was stored in Redis
            mock_redis.setex.assert_called_once()
            call_args = mock_redis.setex.call_args
            assert call_args[0][0] == f"github_oauth_token:{state}"
            assert call_args[0][1] == 600  # 10 minutes TTL

            # Verify stored data
            stored_data = json.loads(call_args[0][2])
            assert stored_data["access_token"] == "gho_test_token_123"
            assert stored_data["tenant_id"] == "tenant-123"
            assert stored_data["user_id"] == "user-456"
            assert stored_data["app_id"] == "app-789"
            assert stored_data["repository_owner"] == "testuser"

    def test_handle_callback_invalid_state(self, mock_config, mock_redis):
        """Test callback handling with invalid state."""
        code = "test-code-123"
        state = "invalid-state"

        with patch.object(OAuthProxyService, "use_proxy_context", side_effect=ValueError("Invalid state")):
            with pytest.raises(ValueError, match="Invalid or expired OAuth state"):
                GitHubOAuthService.handle_callback(code=code, state=state)

    def test_handle_callback_token_exchange_error(self, mock_config, mock_redis, mock_db):
        """Test callback handling when token exchange fails."""
        code = "test-code-123"
        state = "test-state-123"

        context_data = {
            "tenant_id": "tenant-123",
            "user_id": "user-456",
            "plugin_id": "github",
            "provider": "github",
        }

        token_response = {
            "error": "bad_verification_code",
            "error_description": "The code passed is incorrect or expired.",
        }

        with (
            patch.object(OAuthProxyService, "use_proxy_context", return_value=context_data),
            patch("services.github.github_oauth_service.make_request") as mock_request,
        ):
            mock_request.return_value = MagicMock(
                status_code=200,
                json=lambda: token_response,
                raise_for_status=MagicMock(),
            )

            with pytest.raises(ValueError, match="Failed to exchange code for token"):
                GitHubOAuthService.handle_callback(code=code, state=state)

    def test_revoke_connection_success(self, mock_config, mock_db):
        """Test successful connection revocation."""
        connection_id = "connection-123"
        tenant_id = "tenant-123"

        mock_connection = MagicMock(spec=GitHubConnection)
        mock_connection.id = connection_id
        mock_connection.tenant_id = tenant_id
        mock_connection.webhook_id = None

        mock_db.session.query.return_value.where.return_value.first.return_value = mock_connection

        GitHubOAuthService.revoke_connection(connection_id=connection_id, tenant_id=tenant_id)

        mock_db.session.delete.assert_called_once_with(mock_connection)
        mock_db.session.commit.assert_called_once()

    def test_revoke_connection_not_found(self, mock_config, mock_db):
        """Test connection revocation when connection doesn't exist."""
        connection_id = "connection-123"
        tenant_id = "tenant-123"

        mock_db.session.query.return_value.where.return_value.first.return_value = None

        with pytest.raises(ValueError, match="GitHub connection not found"):
            GitHubOAuthService.revoke_connection(connection_id=connection_id, tenant_id=tenant_id)

    def test_refresh_token_not_implemented(self, mock_config, mock_db):
        """Test that token refresh raises NotImplementedError."""
        connection_id = "connection-123"

        mock_connection = MagicMock(spec=GitHubConnection)
        mock_connection.get_decrypted_refresh_token.return_value = "refresh-token-123"
        mock_db.session.get.return_value = mock_connection

        with pytest.raises(NotImplementedError, match="GitHub OAuth refresh token flow is not yet implemented"):
            GitHubOAuthService.refresh_token(connection_id=connection_id)
