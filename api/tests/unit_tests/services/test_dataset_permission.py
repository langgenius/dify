from unittest.mock import Mock, patch

import pytest

from models.account import Account, TenantAccountRole
from models.dataset import Dataset, DatasetPermission, DatasetPermissionEnum
from services.dataset_service import DatasetService
from services.errors.account import NoPermissionError


class DatasetPermissionTestDataFactory:
    """Factory class for creating test data and mock objects for dataset permission tests."""

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "test-tenant-123",
        created_by: str = "creator-456",
        permission: DatasetPermissionEnum = DatasetPermissionEnum.ONLY_ME,
        **kwargs,
    ) -> Mock:
        """Create a mock dataset with specified attributes."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.created_by = created_by
        dataset.permission = permission
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_user_mock(
        user_id: str = "user-789",
        tenant_id: str = "test-tenant-123",
        role: TenantAccountRole = TenantAccountRole.NORMAL,
        **kwargs,
    ) -> Mock:
        """Create a mock user with specified attributes."""
        user = Mock(spec=Account)
        user.id = user_id
        user.current_tenant_id = tenant_id
        user.current_role = role
        for key, value in kwargs.items():
            setattr(user, key, value)
        return user

    @staticmethod
    def create_dataset_permission_mock(
        dataset_id: str = "dataset-123",
        account_id: str = "user-789",
        **kwargs,
    ) -> Mock:
        """Create a mock dataset permission record."""
        permission = Mock(spec=DatasetPermission)
        permission.dataset_id = dataset_id
        permission.account_id = account_id
        for key, value in kwargs.items():
            setattr(permission, key, value)
        return permission


class TestDatasetPermissionService:
    """
    Comprehensive unit tests for DatasetService.check_dataset_permission method.

    This test suite covers all permission scenarios including:
    - Cross-tenant access restrictions
    - Owner privilege checks
    - Different permission levels (ONLY_ME, ALL_TEAM, PARTIAL_TEAM)
    - Explicit permission checks for PARTIAL_TEAM
    - Error conditions and logging
    """

    @pytest.fixture
    def mock_dataset_service_dependencies(self):
        """Common mock setup for dataset service dependencies."""
        with patch("services.dataset_service.db.session") as mock_session:
            yield {
                "db_session": mock_session,
            }

    @pytest.fixture
    def mock_logging_dependencies(self):
        """Mock setup for logging tests."""
        with patch("services.dataset_service.logger") as mock_logging:
            yield {
                "logging": mock_logging,
            }

    def _assert_permission_check_passes(self, dataset: Mock, user: Mock):
        """Helper method to verify that permission check passes without raising exceptions."""
        # Should not raise any exception
        DatasetService.check_dataset_permission(dataset, user)

    def _assert_permission_check_fails(
        self, dataset: Mock, user: Mock, expected_message: str = "You do not have permission to access this dataset."
    ):
        """Helper method to verify that permission check fails with expected error."""
        with pytest.raises(NoPermissionError, match=expected_message):
            DatasetService.check_dataset_permission(dataset, user)

    def _assert_database_query_called(self, mock_session: Mock, dataset_id: str, account_id: str):
        """Helper method to verify database query calls for permission checks."""
        mock_session.query().filter_by.assert_called_with(dataset_id=dataset_id, account_id=account_id)

    def _assert_database_query_not_called(self, mock_session: Mock):
        """Helper method to verify that database query was not called."""
        mock_session.query.assert_not_called()

    # ==================== Cross-Tenant Access Tests ====================

    def test_permission_check_different_tenant_should_fail(self):
        """Test that users from different tenants cannot access dataset regardless of other permissions."""
        # Create dataset and user from different tenants
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123", permission=DatasetPermissionEnum.ALL_TEAM
        )
        user = DatasetPermissionTestDataFactory.create_user_mock(
            user_id="user-789", tenant_id="different-tenant-456", role=TenantAccountRole.EDITOR
        )

        # Should fail due to different tenant
        self._assert_permission_check_fails(dataset, user)

    # ==================== Owner Privilege Tests ====================

    def test_owner_can_access_any_dataset(self):
        """Test that tenant owners can access any dataset regardless of permission level."""
        # Create dataset with restrictive permission
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(permission=DatasetPermissionEnum.ONLY_ME)

        # Create owner user
        owner_user = DatasetPermissionTestDataFactory.create_user_mock(
            user_id="owner-999", role=TenantAccountRole.OWNER
        )

        # Owner should have access regardless of dataset permission
        self._assert_permission_check_passes(dataset, owner_user)

    # ==================== ONLY_ME Permission Tests ====================

    def test_only_me_permission_creator_can_access(self):
        """Test ONLY_ME permission allows only the dataset creator to access."""
        # Create dataset with ONLY_ME permission
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            created_by="creator-456", permission=DatasetPermissionEnum.ONLY_ME
        )

        # Create creator user
        creator_user = DatasetPermissionTestDataFactory.create_user_mock(
            user_id="creator-456", role=TenantAccountRole.EDITOR
        )

        # Creator should be able to access
        self._assert_permission_check_passes(dataset, creator_user)

    def test_only_me_permission_others_cannot_access(self):
        """Test ONLY_ME permission denies access to non-creators."""
        # Create dataset with ONLY_ME permission
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            created_by="creator-456", permission=DatasetPermissionEnum.ONLY_ME
        )

        # Create normal user (not the creator)
        normal_user = DatasetPermissionTestDataFactory.create_user_mock(
            user_id="normal-789", role=TenantAccountRole.NORMAL
        )

        # Non-creator should be denied access
        self._assert_permission_check_fails(dataset, normal_user)

    # ==================== ALL_TEAM Permission Tests ====================

    def test_all_team_permission_allows_access(self):
        """Test ALL_TEAM permission allows any team member to access the dataset."""
        # Create dataset with ALL_TEAM permission
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(permission=DatasetPermissionEnum.ALL_TEAM)

        # Create different types of team members
        normal_user = DatasetPermissionTestDataFactory.create_user_mock(
            user_id="normal-789", role=TenantAccountRole.NORMAL
        )
        editor_user = DatasetPermissionTestDataFactory.create_user_mock(
            user_id="editor-456", role=TenantAccountRole.EDITOR
        )

        # All team members should have access
        self._assert_permission_check_passes(dataset, normal_user)
        self._assert_permission_check_passes(dataset, editor_user)

    # ==================== PARTIAL_TEAM Permission Tests ====================

    def test_partial_team_permission_creator_can_access(self, mock_dataset_service_dependencies):
        """Test PARTIAL_TEAM permission allows creator to access without database query."""
        # Create dataset with PARTIAL_TEAM permission
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            created_by="creator-456", permission=DatasetPermissionEnum.PARTIAL_TEAM
        )

        # Create creator user
        creator_user = DatasetPermissionTestDataFactory.create_user_mock(
            user_id="creator-456", role=TenantAccountRole.EDITOR
        )

        # Creator should have access without database query
        self._assert_permission_check_passes(dataset, creator_user)
        self._assert_database_query_not_called(mock_dataset_service_dependencies["db_session"])

    def test_partial_team_permission_with_explicit_permission(self, mock_dataset_service_dependencies):
        """Test PARTIAL_TEAM permission allows users with explicit permission records."""
        # Create dataset with PARTIAL_TEAM permission
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(permission=DatasetPermissionEnum.PARTIAL_TEAM)

        # Create normal user (not the creator)
        normal_user = DatasetPermissionTestDataFactory.create_user_mock(
            user_id="normal-789", role=TenantAccountRole.NORMAL
        )

        # Mock database query to return a permission record
        mock_permission = DatasetPermissionTestDataFactory.create_dataset_permission_mock(
            dataset_id=dataset.id, account_id=normal_user.id
        )
        mock_dataset_service_dependencies["db_session"].query().filter_by().first.return_value = mock_permission

        # User with explicit permission should have access
        self._assert_permission_check_passes(dataset, normal_user)
        self._assert_database_query_called(mock_dataset_service_dependencies["db_session"], dataset.id, normal_user.id)

    def test_partial_team_permission_without_explicit_permission(self, mock_dataset_service_dependencies):
        """Test PARTIAL_TEAM permission denies users without explicit permission records."""
        # Create dataset with PARTIAL_TEAM permission
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(permission=DatasetPermissionEnum.PARTIAL_TEAM)

        # Create normal user (not the creator)
        normal_user = DatasetPermissionTestDataFactory.create_user_mock(
            user_id="normal-789", role=TenantAccountRole.NORMAL
        )

        # Mock database query to return None (no permission record)
        mock_dataset_service_dependencies["db_session"].query().filter_by().first.return_value = None

        # User without explicit permission should be denied access
        self._assert_permission_check_fails(dataset, normal_user)
        self._assert_database_query_called(mock_dataset_service_dependencies["db_session"], dataset.id, normal_user.id)

    def test_partial_team_permission_non_creator_without_permission_fails(self, mock_dataset_service_dependencies):
        """Test that non-creators without explicit permission are denied access to PARTIAL_TEAM datasets."""
        # Create dataset with PARTIAL_TEAM permission
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            created_by="creator-456", permission=DatasetPermissionEnum.PARTIAL_TEAM
        )

        # Create a different user (not the creator)
        other_user = DatasetPermissionTestDataFactory.create_user_mock(
            user_id="other-user-123", role=TenantAccountRole.NORMAL
        )

        # Mock database query to return None (no permission record)
        mock_dataset_service_dependencies["db_session"].query().filter_by().first.return_value = None

        # Non-creator without explicit permission should be denied access
        self._assert_permission_check_fails(dataset, other_user)
        self._assert_database_query_called(mock_dataset_service_dependencies["db_session"], dataset.id, other_user.id)

    # ==================== Enum Usage Tests ====================

    def test_partial_team_permission_uses_correct_enum(self):
        """Test that the method correctly uses DatasetPermissionEnum.PARTIAL_TEAM instead of string literals."""
        # Create dataset with PARTIAL_TEAM permission using enum
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            created_by="creator-456", permission=DatasetPermissionEnum.PARTIAL_TEAM
        )

        # Create creator user
        creator_user = DatasetPermissionTestDataFactory.create_user_mock(
            user_id="creator-456", role=TenantAccountRole.EDITOR
        )

        # Creator should always have access regardless of permission level
        self._assert_permission_check_passes(dataset, creator_user)

    # ==================== Logging Tests ====================

    def test_permission_denied_logs_debug_message(self, mock_dataset_service_dependencies, mock_logging_dependencies):
        """Test that permission denied events are properly logged for debugging purposes."""
        # Create dataset with PARTIAL_TEAM permission
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(permission=DatasetPermissionEnum.PARTIAL_TEAM)

        # Create normal user (not the creator)
        normal_user = DatasetPermissionTestDataFactory.create_user_mock(
            user_id="normal-789", role=TenantAccountRole.NORMAL
        )

        # Mock database query to return None (no permission record)
        mock_dataset_service_dependencies["db_session"].query().filter_by().first.return_value = None

        # Attempt permission check (should fail)
        with pytest.raises(NoPermissionError):
            DatasetService.check_dataset_permission(dataset, normal_user)

        # Verify debug message was logged with correct user and dataset information
        mock_logging_dependencies["logging"].debug.assert_called_with(
            "User %s does not have permission to access dataset %s", normal_user.id, dataset.id
        )
