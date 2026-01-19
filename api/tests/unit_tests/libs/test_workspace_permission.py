from unittest.mock import Mock, patch

import pytest
from werkzeug.exceptions import Forbidden

from libs.workspace_permission import (
    check_workspace_member_invite_permission,
    check_workspace_owner_transfer_permission,
)


class TestWorkspacePermissionHelper:
    """Test workspace permission helper functions."""

    @patch("libs.workspace_permission.dify_config")
    @patch("libs.workspace_permission.EnterpriseService")
    def test_community_edition_allows_invite(self, mock_enterprise_service, mock_config):
        """Community edition should always allow invitations without calling any service."""
        mock_config.ENTERPRISE_ENABLED = False

        # Should not raise
        check_workspace_member_invite_permission("test-workspace-id")

        # EnterpriseService should NOT be called in community edition
        mock_enterprise_service.WorkspacePermissionService.get_permission.assert_not_called()

    @patch("libs.workspace_permission.dify_config")
    @patch("libs.workspace_permission.FeatureService")
    def test_community_edition_allows_transfer(self, mock_feature_service, mock_config):
        """Community edition should check billing plan but not call enterprise service."""
        mock_config.ENTERPRISE_ENABLED = False
        mock_features = Mock()
        mock_features.is_allow_transfer_workspace = True
        mock_feature_service.get_features.return_value = mock_features

        # Should not raise
        check_workspace_owner_transfer_permission("test-workspace-id")

        mock_feature_service.get_features.assert_called_once_with("test-workspace-id")

    @patch("libs.workspace_permission.EnterpriseService")
    @patch("libs.workspace_permission.dify_config")
    def test_enterprise_blocks_invite_when_disabled(self, mock_config, mock_enterprise_service):
        """Enterprise edition should block invitations when workspace policy is False."""
        mock_config.ENTERPRISE_ENABLED = True

        mock_permission = Mock()
        mock_permission.allow_member_invite = False
        mock_enterprise_service.WorkspacePermissionService.get_permission.return_value = mock_permission

        with pytest.raises(Forbidden, match="Workspace policy prohibits member invitations"):
            check_workspace_member_invite_permission("test-workspace-id")

        mock_enterprise_service.WorkspacePermissionService.get_permission.assert_called_once_with("test-workspace-id")

    @patch("libs.workspace_permission.EnterpriseService")
    @patch("libs.workspace_permission.dify_config")
    def test_enterprise_allows_invite_when_enabled(self, mock_config, mock_enterprise_service):
        """Enterprise edition should allow invitations when workspace policy is True."""
        mock_config.ENTERPRISE_ENABLED = True

        mock_permission = Mock()
        mock_permission.allow_member_invite = True
        mock_enterprise_service.WorkspacePermissionService.get_permission.return_value = mock_permission

        # Should not raise
        check_workspace_member_invite_permission("test-workspace-id")

        mock_enterprise_service.WorkspacePermissionService.get_permission.assert_called_once_with("test-workspace-id")

    @patch("libs.workspace_permission.EnterpriseService")
    @patch("libs.workspace_permission.dify_config")
    @patch("libs.workspace_permission.FeatureService")
    def test_billing_plan_blocks_transfer(self, mock_feature_service, mock_config, mock_enterprise_service):
        """SANDBOX billing plan should block owner transfer before checking enterprise policy."""
        mock_config.ENTERPRISE_ENABLED = True
        mock_features = Mock()
        mock_features.is_allow_transfer_workspace = False  # SANDBOX plan
        mock_feature_service.get_features.return_value = mock_features

        with pytest.raises(Forbidden, match="Your current plan does not allow workspace ownership transfer"):
            check_workspace_owner_transfer_permission("test-workspace-id")

        # Enterprise service should NOT be called since billing plan already blocks
        mock_enterprise_service.WorkspacePermissionService.get_permission.assert_not_called()

    @patch("libs.workspace_permission.EnterpriseService")
    @patch("libs.workspace_permission.dify_config")
    @patch("libs.workspace_permission.FeatureService")
    def test_enterprise_blocks_transfer_when_disabled(self, mock_feature_service, mock_config, mock_enterprise_service):
        """Enterprise edition should block transfer when workspace policy is False."""
        mock_config.ENTERPRISE_ENABLED = True
        mock_features = Mock()
        mock_features.is_allow_transfer_workspace = True  # Billing plan allows
        mock_feature_service.get_features.return_value = mock_features

        mock_permission = Mock()
        mock_permission.allow_owner_transfer = False  # Workspace policy blocks
        mock_enterprise_service.WorkspacePermissionService.get_permission.return_value = mock_permission

        with pytest.raises(Forbidden, match="Workspace policy prohibits ownership transfer"):
            check_workspace_owner_transfer_permission("test-workspace-id")

        mock_enterprise_service.WorkspacePermissionService.get_permission.assert_called_once_with("test-workspace-id")

    @patch("libs.workspace_permission.EnterpriseService")
    @patch("libs.workspace_permission.dify_config")
    @patch("libs.workspace_permission.FeatureService")
    def test_enterprise_allows_transfer_when_both_enabled(
        self, mock_feature_service, mock_config, mock_enterprise_service
    ):
        """Enterprise edition should allow transfer when both billing and workspace policy allow."""
        mock_config.ENTERPRISE_ENABLED = True
        mock_features = Mock()
        mock_features.is_allow_transfer_workspace = True  # Billing plan allows
        mock_feature_service.get_features.return_value = mock_features

        mock_permission = Mock()
        mock_permission.allow_owner_transfer = True  # Workspace policy allows
        mock_enterprise_service.WorkspacePermissionService.get_permission.return_value = mock_permission

        # Should not raise
        check_workspace_owner_transfer_permission("test-workspace-id")

        mock_enterprise_service.WorkspacePermissionService.get_permission.assert_called_once_with("test-workspace-id")

    @patch("libs.workspace_permission.logger")
    @patch("libs.workspace_permission.EnterpriseService")
    @patch("libs.workspace_permission.dify_config")
    def test_enterprise_service_error_fails_open(self, mock_config, mock_enterprise_service, mock_logger):
        """On enterprise service error, should fail-open (allow) and log error."""
        mock_config.ENTERPRISE_ENABLED = True

        # Simulate enterprise service error
        mock_enterprise_service.WorkspacePermissionService.get_permission.side_effect = Exception("Service unavailable")

        # Should not raise (fail-open)
        check_workspace_member_invite_permission("test-workspace-id")

        # Should log the error
        mock_logger.exception.assert_called_once()
        assert "Failed to check workspace invite permission" in str(mock_logger.exception.call_args)
