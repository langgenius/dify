"""
Unit tests for end-user tool authentication.

Tests the integration of end-user authentication with tool runtime resolution.
"""

import time
from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.entities.tool_entities import ToolAuthType, ToolInvokeFrom, ToolProviderType
from core.tools.errors import ToolProviderNotFoundError
from core.tools.tool_manager import ToolManager


@pytest.fixture
def mock_db_session():
    """Mock database session."""
    with patch("core.tools.tool_manager.db") as mock_db:
        yield mock_db.session


@pytest.fixture
def mock_provider_controller():
    """Mock builtin provider controller."""
    controller = MagicMock()
    controller.need_credentials = True
    controller.get_tool = MagicMock(return_value=MagicMock())
    controller.get_credentials_schema_by_type = MagicMock(return_value=[])
    return controller


class TestEndUserToolAuthentication:
    """Test suite for end-user tool authentication."""

    def test_end_user_auth_requires_end_user_id(self, mock_db_session, mock_provider_controller):
        """
        Test that END_USER auth_type requires end_user_id parameter.

        When auth_type is END_USER but end_user_id is None, should raise error.
        """
        with patch.object(ToolManager, "get_builtin_provider", return_value=mock_provider_controller):
            with pytest.raises(ToolProviderNotFoundError, match="end_user_id is required"):
                ToolManager.get_tool_runtime(
                    provider_type=ToolProviderType.BUILT_IN,
                    provider_id="test_provider",
                    tool_name="test_tool",
                    tenant_id="test_tenant",
                    invoke_from=InvokeFrom.SERVICE_API,
                    tool_invoke_from=ToolInvokeFrom.WORKFLOW,
                    auth_type=ToolAuthType.END_USER,
                    end_user_id=None,  # Missing!
                )

    def test_end_user_auth_missing_credentials(self, mock_db_session, mock_provider_controller):
        """
        Test that error is raised when end-user has no credentials for provider.

        When auth_type is END_USER but no credentials exist, should raise error.
        """
        # Mock no credentials found
        mock_db_session.query.return_value.where.return_value.order_by.return_value.first.return_value = None

        with patch.object(ToolManager, "get_builtin_provider", return_value=mock_provider_controller):
            with pytest.raises(ToolProviderNotFoundError, match="No end-user credentials found"):
                ToolManager.get_tool_runtime(
                    provider_type=ToolProviderType.BUILT_IN,
                    provider_id="test_provider",
                    tool_name="test_tool",
                    tenant_id="test_tenant",
                    invoke_from=InvokeFrom.SERVICE_API,
                    tool_invoke_from=ToolInvokeFrom.WORKFLOW,
                    auth_type=ToolAuthType.END_USER,
                    end_user_id="end_user_123",
                )

    def test_end_user_auth_with_credentials(self, mock_db_session, mock_provider_controller):
        """
        Test successful end-user credential resolution.

        When auth_type is END_USER and credentials exist, should return tool runtime.
        """
        # Mock end-user provider
        mock_enduser_provider = MagicMock()
        mock_enduser_provider.id = "cred_123"
        mock_enduser_provider.credential_type = "api-key"
        mock_enduser_provider.credentials = '{"api_key": "encrypted"}'
        mock_enduser_provider.expires_at = -1  # No expiry

        mock_db_session.query.return_value.where.return_value.order_by.return_value.first.return_value = (
            mock_enduser_provider
        )

        # Mock encrypter
        mock_encrypter = MagicMock()
        mock_encrypter.decrypt.return_value = {"api_key": "decrypted_key"}
        mock_cache = MagicMock()

        with (
            patch.object(ToolManager, "get_builtin_provider", return_value=mock_provider_controller),
            patch("core.tools.tool_manager.create_provider_encrypter", return_value=(mock_encrypter, mock_cache)),
        ):
            tool_runtime = ToolManager.get_tool_runtime(
                provider_type=ToolProviderType.BUILT_IN,
                provider_id="test_provider",
                tool_name="test_tool",
                tenant_id="test_tenant",
                invoke_from=InvokeFrom.SERVICE_API,
                tool_invoke_from=ToolInvokeFrom.WORKFLOW,
                auth_type=ToolAuthType.END_USER,
                end_user_id="end_user_123",
            )

            # Verify tool runtime was created
            assert tool_runtime is not None
            # Verify encrypter was called with decrypted credentials
            mock_encrypter.decrypt.assert_called_once()

    def test_workspace_auth_backward_compatibility(self, mock_db_session, mock_provider_controller):
        """
        Test that workspace authentication still works (backward compatibility).

        When auth_type is WORKSPACE (default), should use workspace credentials.
        """
        # Mock workspace provider
        mock_workspace_provider = MagicMock()
        mock_workspace_provider.id = "workspace_cred_123"
        mock_workspace_provider.credential_type = "api-key"
        mock_workspace_provider.credentials = '{"api_key": "workspace_encrypted"}'
        mock_workspace_provider.expires_at = -1

        mock_db_session.query.return_value.where.return_value.order_by.return_value.first.return_value = (
            mock_workspace_provider
        )

        # Mock encrypter
        mock_encrypter = MagicMock()
        mock_encrypter.decrypt.return_value = {"api_key": "workspace_decrypted"}
        mock_cache = MagicMock()

        with (
            patch.object(ToolManager, "get_builtin_provider", return_value=mock_provider_controller),
            patch("core.tools.tool_manager.create_provider_encrypter", return_value=(mock_encrypter, mock_cache)),
            patch("core.helper.credential_utils.check_credential_policy_compliance"),
        ):
            tool_runtime = ToolManager.get_tool_runtime(
                provider_type=ToolProviderType.BUILT_IN,
                provider_id="test_provider",
                tool_name="test_tool",
                tenant_id="test_tenant",
                invoke_from=InvokeFrom.SERVICE_API,
                tool_invoke_from=ToolInvokeFrom.WORKFLOW,
                auth_type=ToolAuthType.WORKSPACE,  # Workspace auth
                end_user_id=None,  # Not needed for workspace auth
            )

            # Verify tool runtime was created
            assert tool_runtime is not None

    def test_workflow_tool_runtime_passes_end_user_id(self, mock_db_session, mock_provider_controller):
        """
        Test that get_workflow_tool_runtime correctly passes end_user_id to get_tool_runtime.
        """
        from core.workflow.nodes.tool.entities import ToolEntity

        # Create a mock ToolEntity with END_USER auth_type
        workflow_tool = MagicMock(spec=ToolEntity)
        workflow_tool.provider_type = ToolProviderType.BUILT_IN
        workflow_tool.provider_id = "test_provider"
        workflow_tool.tool_name = "test_tool"
        workflow_tool.credential_id = None
        workflow_tool.auth_type = ToolAuthType.END_USER
        workflow_tool.tool_configurations = {}

        # Mock end-user credentials
        mock_enduser_provider = MagicMock()
        mock_enduser_provider.id = "cred_123"
        mock_enduser_provider.credential_type = "api-key"
        mock_enduser_provider.credentials = '{"api_key": "encrypted"}'
        mock_enduser_provider.expires_at = -1

        mock_db_session.query.return_value.where.return_value.order_by.return_value.first.return_value = (
            mock_enduser_provider
        )

        mock_encrypter = MagicMock()
        mock_encrypter.decrypt.return_value = {"api_key": "decrypted"}
        mock_cache = MagicMock()

        with (
            patch.object(ToolManager, "get_builtin_provider", return_value=mock_provider_controller),
            patch("core.tools.tool_manager.create_provider_encrypter", return_value=(mock_encrypter, mock_cache)),
        ):
            tool_runtime = ToolManager.get_workflow_tool_runtime(
                tenant_id="test_tenant",
                app_id="test_app",
                node_id="test_node",
                workflow_tool=workflow_tool,
                invoke_from=InvokeFrom.SERVICE_API,
                variable_pool=None,
                end_user_id="end_user_123",  # Pass end_user_id
            )

            # Verify tool runtime was created
            assert tool_runtime is not None


class TestOAuthTokenRefresh:
    """Test suite for OAuth token refresh functionality."""

    def test_enduser_oauth_token_refresh_when_expired(self, mock_db_session, mock_provider_controller):
        """
        Test that end-user OAuth tokens are automatically refreshed when expired.

        When an OAuth token is expired (expires_at < current_time + 60s buffer),
        the system should automatically refresh it before using.
        """
        # Mock end-user provider with expired OAuth token
        mock_enduser_provider = MagicMock()
        mock_enduser_provider.id = "cred_123"
        mock_enduser_provider.credential_type = "oauth2"
        mock_enduser_provider.credentials = '{"access_token": "old_token", "refresh_token": "refresh"}'
        # Set expiry to past (token expired)
        mock_enduser_provider.expires_at = int(time.time()) - 100
        mock_enduser_provider.encrypted_credentials = '{"access_token": "old_token", "refresh_token": "refresh"}'

        mock_db_session.query.return_value.where.return_value.order_by.return_value.first.return_value = (
            mock_enduser_provider
        )

        # Mock encrypter
        mock_encrypter = MagicMock()
        mock_encrypter.decrypt.return_value = {"access_token": "old_token", "refresh_token": "refresh"}
        mock_encrypter.encrypt.return_value = {"access_token": "new_token", "refresh_token": "refresh"}
        mock_cache = MagicMock()

        # Mock OAuth refresh response
        mock_refreshed_credentials = MagicMock()
        mock_refreshed_credentials.credentials = {"access_token": "new_token", "refresh_token": "refresh"}
        mock_refreshed_credentials.expires_at = int(time.time()) + 3600  # New expiry 1 hour from now

        with (
            patch.object(ToolManager, "get_builtin_provider", return_value=mock_provider_controller),
            patch("core.tools.tool_manager.create_provider_encrypter", return_value=(mock_encrypter, mock_cache)),
            patch.object(
                ToolManager,
                "_refresh_oauth_credentials",
                return_value=(
                    mock_refreshed_credentials.credentials,
                    mock_refreshed_credentials.expires_at,
                ),
            ) as mock_refresh,
        ):
            tool_runtime = ToolManager.get_tool_runtime(
                provider_type=ToolProviderType.BUILT_IN,
                provider_id="github",
                tool_name="test_tool",
                tenant_id="test_tenant",
                invoke_from=InvokeFrom.SERVICE_API,
                tool_invoke_from=ToolInvokeFrom.WORKFLOW,
                auth_type=ToolAuthType.END_USER,
                end_user_id="end_user_123",
            )

            # Verify refresh was called
            mock_refresh.assert_called_once_with(
                tenant_id="test_tenant",
                provider_id="github",
                user_id="end_user_123",
                decrypted_credentials={"access_token": "old_token", "refresh_token": "refresh"},
            )

            # Verify provider was updated with new credentials
            assert mock_enduser_provider.expires_at == mock_refreshed_credentials.expires_at
            mock_db_session.commit.assert_called_once()
            mock_cache.delete.assert_called_once()

            # Verify tool runtime was created
            assert tool_runtime is not None

    def test_enduser_oauth_token_not_refreshed_when_valid(self, mock_db_session, mock_provider_controller):
        """
        Test that valid OAuth tokens are NOT refreshed.

        When an OAuth token is still valid (expires_at > current_time + 60s buffer),
        the system should use it without refreshing.
        """
        # Mock end-user provider with valid OAuth token
        mock_enduser_provider = MagicMock()
        mock_enduser_provider.id = "cred_123"
        mock_enduser_provider.credential_type = "oauth2"
        mock_enduser_provider.credentials = '{"access_token": "valid_token", "refresh_token": "refresh"}'
        # Set expiry to future (token still valid with buffer)
        mock_enduser_provider.expires_at = int(time.time()) + 3600  # Valid for 1 hour

        mock_db_session.query.return_value.where.return_value.order_by.return_value.first.return_value = (
            mock_enduser_provider
        )

        # Mock encrypter
        mock_encrypter = MagicMock()
        mock_encrypter.decrypt.return_value = {"access_token": "valid_token", "refresh_token": "refresh"}
        mock_cache = MagicMock()

        with (
            patch.object(ToolManager, "get_builtin_provider", return_value=mock_provider_controller),
            patch("core.tools.tool_manager.create_provider_encrypter", return_value=(mock_encrypter, mock_cache)),
            patch.object(ToolManager, "_refresh_oauth_credentials") as mock_refresh,
        ):
            tool_runtime = ToolManager.get_tool_runtime(
                provider_type=ToolProviderType.BUILT_IN,
                provider_id="github",
                tool_name="test_tool",
                tenant_id="test_tenant",
                invoke_from=InvokeFrom.SERVICE_API,
                tool_invoke_from=ToolInvokeFrom.WORKFLOW,
                auth_type=ToolAuthType.END_USER,
                end_user_id="end_user_123",
            )

            # Verify refresh was NOT called (token still valid)
            mock_refresh.assert_not_called()

            # Verify tool runtime was created with original credentials
            assert tool_runtime is not None

    def test_workspace_oauth_token_refresh_when_expired(self, mock_db_session, mock_provider_controller):
        """
        Test that workspace OAuth tokens are automatically refreshed when expired.

        This ensures the refactored _refresh_oauth_credentials helper works
        for both end-user and workspace authentication flows.
        """
        # Mock workspace provider with expired OAuth token
        mock_workspace_provider = MagicMock()
        mock_workspace_provider.id = "workspace_cred_123"
        mock_workspace_provider.user_id = "workspace_user_456"
        mock_workspace_provider.credential_type = "oauth2"
        mock_workspace_provider.credentials = '{"access_token": "old_workspace_token"}'
        mock_workspace_provider.expires_at = int(time.time()) - 100  # Expired
        mock_workspace_provider.encrypted_credentials = '{"access_token": "old_workspace_token"}'

        mock_db_session.query.return_value.where.return_value.order_by.return_value.first.return_value = (
            mock_workspace_provider
        )

        # Mock encrypter
        mock_encrypter = MagicMock()
        mock_encrypter.decrypt.return_value = {"access_token": "old_workspace_token"}
        mock_encrypter.encrypt.return_value = {"access_token": "new_workspace_token"}
        mock_cache = MagicMock()

        # Mock OAuth refresh response
        refreshed_creds = {"access_token": "new_workspace_token"}
        new_expires_at = int(time.time()) + 3600

        with (
            patch.object(ToolManager, "get_builtin_provider", return_value=mock_provider_controller),
            patch("core.tools.tool_manager.create_provider_encrypter", return_value=(mock_encrypter, mock_cache)),
            patch("core.helper.credential_utils.check_credential_policy_compliance"),
            patch.object(
                ToolManager, "_refresh_oauth_credentials", return_value=(refreshed_creds, new_expires_at)
            ) as mock_refresh,
        ):
            tool_runtime = ToolManager.get_tool_runtime(
                provider_type=ToolProviderType.BUILT_IN,
                provider_id="github",
                tool_name="test_tool",
                tenant_id="test_tenant",
                invoke_from=InvokeFrom.SERVICE_API,
                tool_invoke_from=ToolInvokeFrom.WORKFLOW,
                auth_type=ToolAuthType.WORKSPACE,
            )

            # Verify refresh was called with workspace user_id
            mock_refresh.assert_called_once_with(
                tenant_id="test_tenant",
                provider_id="github",
                user_id="workspace_user_456",
                decrypted_credentials={"access_token": "old_workspace_token"},
            )

            # Verify provider was updated
            assert mock_workspace_provider.expires_at == new_expires_at
            mock_db_session.commit.assert_called_once()
            mock_cache.delete.assert_called_once()

            # Verify tool runtime was created
            assert tool_runtime is not None

    def test_oauth_token_no_refresh_for_non_oauth_credentials(self, mock_db_session, mock_provider_controller):
        """
        Test that non-OAuth credentials (API keys) are never refreshed.

        API keys with expires_at = -1 should not trigger refresh logic.
        """
        # Mock end-user provider with API key (no expiry)
        mock_enduser_provider = MagicMock()
        mock_enduser_provider.id = "cred_123"
        mock_enduser_provider.credential_type = "api-key"
        mock_enduser_provider.credentials = '{"api_key": "sk-1234567890"}'
        mock_enduser_provider.expires_at = -1  # API keys don't expire

        mock_db_session.query.return_value.where.return_value.order_by.return_value.first.return_value = (
            mock_enduser_provider
        )

        # Mock encrypter
        mock_encrypter = MagicMock()
        mock_encrypter.decrypt.return_value = {"api_key": "sk-1234567890"}
        mock_cache = MagicMock()

        with (
            patch.object(ToolManager, "get_builtin_provider", return_value=mock_provider_controller),
            patch("core.tools.tool_manager.create_provider_encrypter", return_value=(mock_encrypter, mock_cache)),
            patch.object(ToolManager, "_refresh_oauth_credentials") as mock_refresh,
        ):
            tool_runtime = ToolManager.get_tool_runtime(
                provider_type=ToolProviderType.BUILT_IN,
                provider_id="openai",
                tool_name="test_tool",
                tenant_id="test_tenant",
                invoke_from=InvokeFrom.SERVICE_API,
                tool_invoke_from=ToolInvokeFrom.WORKFLOW,
                auth_type=ToolAuthType.END_USER,
                end_user_id="end_user_123",
            )

            # Verify refresh was NOT called (API key doesn't need refresh)
            mock_refresh.assert_not_called()

            # Verify tool runtime was created
            assert tool_runtime is not None

    def test_refresh_oauth_credentials_helper_method(self):
        """
        Test the _refresh_oauth_credentials helper method directly.

        This tests the centralized OAuth refresh logic that is used by both
        end-user and workspace authentication flows.
        """
        # Mock dependencies
        mock_oauth_handler = MagicMock()
        mock_refreshed = MagicMock()
        mock_refreshed.credentials = {"access_token": "new_token", "refresh_token": "new_refresh"}
        mock_refreshed.expires_at = int(time.time()) + 7200
        mock_oauth_handler.refresh_credentials.return_value = mock_refreshed

        with (
            # Patch OAuthHandler where it's imported (inside the method)
            patch("core.plugin.impl.oauth.OAuthHandler", return_value=mock_oauth_handler),
            patch("core.tools.tool_manager.ToolProviderID") as mock_provider_id,
            patch(
                "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client",
                return_value={"client_id": "test"},
            ),
            patch("core.tools.tool_manager.dify_config.CONSOLE_API_URL", "http://localhost:5001"),
        ):
            # Setup provider ID mock
            mock_provider_id.return_value.provider_name = "github"
            mock_provider_id.return_value.plugin_id = "builtin"

            # Call the helper method
            credentials, expires_at = ToolManager._refresh_oauth_credentials(
                tenant_id="test_tenant",
                provider_id="langgenius/github/github",
                user_id="user_123",
                decrypted_credentials={"access_token": "old_token", "refresh_token": "old_refresh"},
            )

            # Verify OAuth handler was called correctly
            mock_oauth_handler.refresh_credentials.assert_called_once_with(
                tenant_id="test_tenant",
                user_id="user_123",
                plugin_id="builtin",
                provider="github",
                redirect_uri="http://localhost:5001/console/api/oauth/plugin/langgenius/github/github/tool/callback",
                system_credentials={"client_id": "test"},
                credentials={"access_token": "old_token", "refresh_token": "old_refresh"},
            )

            # Verify returned values
            assert credentials == {"access_token": "new_token", "refresh_token": "new_refresh"}
            assert expires_at == mock_refreshed.expires_at
