"""
Unit tests for end-user tool authentication.

Tests the integration of end-user authentication with tool runtime resolution.
"""

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
