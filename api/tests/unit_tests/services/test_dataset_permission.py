from unittest.mock import Mock, patch

import pytest

from models.account import Account, TenantAccountRole
from models.dataset import Dataset, DatasetPermission, DatasetPermissionEnum
from services.dataset_service import DatasetService
from services.errors.account import NoPermissionError


class TestDatasetPermissionService:
    """Test cases for dataset permission checking functionality"""

    def setup_method(self):
        """Set up test fixtures"""
        # Mock tenant and user
        self.tenant_id = "test-tenant-123"
        self.creator_id = "creator-456"
        self.normal_user_id = "normal-789"
        self.owner_user_id = "owner-999"

        # Mock dataset
        self.dataset = Mock(spec=Dataset)
        self.dataset.id = "dataset-123"
        self.dataset.tenant_id = self.tenant_id
        self.dataset.created_by = self.creator_id

        # Mock users
        self.creator_user = Mock(spec=Account)
        self.creator_user.id = self.creator_id
        self.creator_user.current_tenant_id = self.tenant_id
        self.creator_user.current_role = TenantAccountRole.EDITOR

        self.normal_user = Mock(spec=Account)
        self.normal_user.id = self.normal_user_id
        self.normal_user.current_tenant_id = self.tenant_id
        self.normal_user.current_role = TenantAccountRole.NORMAL

        self.owner_user = Mock(spec=Account)
        self.owner_user.id = self.owner_user_id
        self.owner_user.current_tenant_id = self.tenant_id
        self.owner_user.current_role = TenantAccountRole.OWNER

    def test_permission_check_different_tenant_should_fail(self):
        """Test that users from different tenants cannot access dataset"""
        self.normal_user.current_tenant_id = "different-tenant"

        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset."):
            DatasetService.check_dataset_permission(self.dataset, self.normal_user)

    def test_owner_can_access_any_dataset(self):
        """Test that tenant owners can access any dataset regardless of permission"""
        self.dataset.permission = DatasetPermissionEnum.ONLY_ME

        # Should not raise any exception
        DatasetService.check_dataset_permission(self.dataset, self.owner_user)

    def test_only_me_permission_creator_can_access(self):
        """Test ONLY_ME permission allows only creator to access"""
        self.dataset.permission = DatasetPermissionEnum.ONLY_ME

        # Creator should be able to access
        DatasetService.check_dataset_permission(self.dataset, self.creator_user)

    def test_only_me_permission_others_cannot_access(self):
        """Test ONLY_ME permission denies access to non-creators"""
        self.dataset.permission = DatasetPermissionEnum.ONLY_ME

        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset."):
            DatasetService.check_dataset_permission(self.dataset, self.normal_user)

    def test_all_team_permission_allows_access(self):
        """Test ALL_TEAM permission allows any team member to access"""
        self.dataset.permission = DatasetPermissionEnum.ALL_TEAM

        # Should not raise any exception for team members
        DatasetService.check_dataset_permission(self.dataset, self.normal_user)
        DatasetService.check_dataset_permission(self.dataset, self.creator_user)

    @patch("services.dataset_service.db.session")
    def test_partial_team_permission_creator_can_access(self, mock_session):
        """Test PARTIAL_TEAM permission allows creator to access"""
        self.dataset.permission = DatasetPermissionEnum.PARTIAL_TEAM

        # Should not raise any exception for creator
        DatasetService.check_dataset_permission(self.dataset, self.creator_user)

        # Should not query database for creator
        mock_session.query.assert_not_called()

    @patch("services.dataset_service.db.session")
    def test_partial_team_permission_with_explicit_permission(self, mock_session):
        """Test PARTIAL_TEAM permission allows users with explicit permission"""
        self.dataset.permission = DatasetPermissionEnum.PARTIAL_TEAM

        # Mock database query to return a permission record
        mock_permission = Mock(spec=DatasetPermission)
        mock_session.query().filter_by().first.return_value = mock_permission

        # Should not raise any exception
        DatasetService.check_dataset_permission(self.dataset, self.normal_user)

        # Verify database was queried correctly
        mock_session.query().filter_by.assert_called_with(dataset_id=self.dataset.id, account_id=self.normal_user.id)

    @patch("services.dataset_service.db.session")
    def test_partial_team_permission_without_explicit_permission(self, mock_session):
        """Test PARTIAL_TEAM permission denies users without explicit permission"""
        self.dataset.permission = DatasetPermissionEnum.PARTIAL_TEAM

        # Mock database query to return None (no permission record)
        mock_session.query().filter_by().first.return_value = None

        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset."):
            DatasetService.check_dataset_permission(self.dataset, self.normal_user)

        # Verify database was queried correctly
        mock_session.query().filter_by.assert_called_with(dataset_id=self.dataset.id, account_id=self.normal_user.id)

    @patch("services.dataset_service.db.session")
    def test_partial_team_permission_non_creator_without_permission_fails(self, mock_session):
        """Test that non-creators without explicit permission are denied access"""
        self.dataset.permission = DatasetPermissionEnum.PARTIAL_TEAM

        # Create a different user (not the creator)
        other_user = Mock(spec=Account)
        other_user.id = "other-user-123"
        other_user.current_tenant_id = self.tenant_id
        other_user.current_role = TenantAccountRole.NORMAL

        # Mock database query to return None (no permission record)
        mock_session.query().filter_by().first.return_value = None

        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset."):
            DatasetService.check_dataset_permission(self.dataset, other_user)

    def test_partial_team_permission_uses_correct_enum(self):
        """Test that the method correctly uses DatasetPermissionEnum.PARTIAL_TEAM"""
        # This test ensures we're using the enum instead of string literals
        self.dataset.permission = DatasetPermissionEnum.PARTIAL_TEAM

        # Creator should always have access
        DatasetService.check_dataset_permission(self.dataset, self.creator_user)

    @patch("services.dataset_service.logging")
    @patch("services.dataset_service.db.session")
    def test_permission_denied_logs_debug_message(self, mock_session, mock_logging):
        """Test that permission denied events are logged"""
        self.dataset.permission = DatasetPermissionEnum.PARTIAL_TEAM
        mock_session.query().filter_by().first.return_value = None

        with pytest.raises(NoPermissionError):
            DatasetService.check_dataset_permission(self.dataset, self.normal_user)

        # Verify debug message was logged
        mock_logging.debug.assert_called_with(
            f"User {self.normal_user.id} does not have permission to access dataset {self.dataset.id}"
        )
