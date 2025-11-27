"""
Comprehensive unit tests for DatasetPermissionService and DatasetService permission methods.

This module contains extensive unit tests for dataset permission management,
including partial member list operations, permission validation, and permission
enum handling.

The DatasetPermissionService provides methods for:
- Retrieving partial member permissions (get_dataset_partial_member_list)
- Updating partial member lists (update_partial_member_list)
- Validating permissions before operations (check_permission)
- Clearing partial member lists (clear_partial_member_list)

The DatasetService provides permission checking methods:
- check_dataset_permission - validates user access to dataset
- check_dataset_operator_permission - validates operator permissions

These operations are critical for dataset access control and security, ensuring
that users can only access datasets they have permission to view or modify.

This test suite ensures:
- Correct retrieval of partial member lists
- Proper update of partial member permissions
- Accurate permission validation logic
- Proper handling of permission enums (only_me, all_team_members, partial_members)
- Security boundaries are maintained
- Error conditions are handled correctly

================================================================================
ARCHITECTURE OVERVIEW
================================================================================

The Dataset permission system is a multi-layered access control mechanism
that provides fine-grained control over who can access and modify datasets.

1. Permission Levels:
   - only_me: Only the dataset creator can access
   - all_team_members: All members of the tenant can access
   - partial_members: Only specific users listed in DatasetPermission can access

2. Permission Storage:
   - Dataset.permission: Stores the permission level enum
   - DatasetPermission: Stores individual user permissions for partial_members
   - Each DatasetPermission record links a dataset to a user account

3. Permission Validation:
   - Tenant-level checks: Users must be in the same tenant
   - Role-based checks: OWNER role bypasses some restrictions
   - Explicit permission checks: For partial_members, explicit DatasetPermission
     records are required

4. Permission Operations:
   - Partial member list management: Add/remove users from partial access
   - Permission validation: Check before allowing operations
   - Permission clearing: Remove all partial members when changing permission level

================================================================================
TESTING STRATEGY
================================================================================

This test suite follows a comprehensive testing strategy that covers:

1. Partial Member List Operations:
   - Retrieving member lists
   - Adding new members
   - Updating existing members
   - Removing members
   - Empty list handling

2. Permission Validation:
   - Dataset editor permissions
   - Dataset operator restrictions
   - Permission enum validation
   - Partial member list validation
   - Tenant isolation

3. Permission Enum Handling:
   - only_me permission behavior
   - all_team_members permission behavior
   - partial_members permission behavior
   - Permission transitions
   - Edge cases for each enum value

4. Security and Access Control:
   - Tenant boundary enforcement
   - Role-based access control
   - Creator privilege validation
   - Explicit permission requirement

5. Error Handling:
   - Invalid permission changes
   - Missing required data
   - Database transaction failures
   - Permission denial scenarios

================================================================================
"""

from unittest.mock import Mock, create_autospec, patch

import pytest

from models import Account, TenantAccountRole
from models.dataset import (
    Dataset,
    DatasetPermission,
    DatasetPermissionEnum,
)
from services.dataset_service import DatasetPermissionService, DatasetService
from services.errors.account import NoPermissionError

# ============================================================================
# Test Data Factory
# ============================================================================
# The Test Data Factory pattern is used here to centralize the creation of
# test objects and mock instances. This approach provides several benefits:
#
# 1. Consistency: All test objects are created using the same factory methods,
#    ensuring consistent structure across all tests.
#
# 2. Maintainability: If the structure of models or services changes, we only
#    need to update the factory methods rather than every individual test.
#
# 3. Reusability: Factory methods can be reused across multiple test classes,
#    reducing code duplication.
#
# 4. Readability: Tests become more readable when they use descriptive factory
#    method calls instead of complex object construction logic.
#
# ============================================================================


class DatasetPermissionTestDataFactory:
    """
    Factory class for creating test data and mock objects for dataset permission tests.

    This factory provides static methods to create mock objects for:
    - Dataset instances with various permission configurations
    - User/Account instances with different roles and permissions
    - DatasetPermission instances
    - Permission enum values
    - Database query results

    The factory methods help maintain consistency across tests and reduce
    code duplication when setting up test scenarios.
    """

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        permission: DatasetPermissionEnum = DatasetPermissionEnum.ONLY_ME,
        created_by: str = "user-123",
        name: str = "Test Dataset",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Dataset with specified attributes.

        Args:
            dataset_id: Unique identifier for the dataset
            tenant_id: Tenant identifier
            permission: Permission level enum
            created_by: ID of user who created the dataset
            name: Dataset name
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a Dataset instance
        """
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.permission = permission
        dataset.created_by = created_by
        dataset.name = name
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_user_mock(
        user_id: str = "user-123",
        tenant_id: str = "tenant-123",
        role: TenantAccountRole = TenantAccountRole.NORMAL,
        is_dataset_editor: bool = True,
        is_dataset_operator: bool = False,
        **kwargs,
    ) -> Mock:
        """
        Create a mock user (Account) with specified attributes.

        Args:
            user_id: Unique identifier for the user
            tenant_id: Tenant identifier
            role: User role (OWNER, ADMIN, NORMAL, DATASET_OPERATOR, etc.)
            is_dataset_editor: Whether user has dataset editor permissions
            is_dataset_operator: Whether user is a dataset operator
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as an Account instance
        """
        user = create_autospec(Account, instance=True)
        user.id = user_id
        user.current_tenant_id = tenant_id
        user.current_role = role
        user.is_dataset_editor = is_dataset_editor
        user.is_dataset_operator = is_dataset_operator
        for key, value in kwargs.items():
            setattr(user, key, value)
        return user

    @staticmethod
    def create_dataset_permission_mock(
        permission_id: str = "permission-123",
        dataset_id: str = "dataset-123",
        account_id: str = "user-456",
        tenant_id: str = "tenant-123",
        has_permission: bool = True,
        **kwargs,
    ) -> Mock:
        """
        Create a mock DatasetPermission instance.

        Args:
            permission_id: Unique identifier for the permission
            dataset_id: Dataset ID
            account_id: User account ID
            tenant_id: Tenant identifier
            has_permission: Whether permission is granted
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a DatasetPermission instance
        """
        permission = Mock(spec=DatasetPermission)
        permission.id = permission_id
        permission.dataset_id = dataset_id
        permission.account_id = account_id
        permission.tenant_id = tenant_id
        permission.has_permission = has_permission
        for key, value in kwargs.items():
            setattr(permission, key, value)
        return permission

    @staticmethod
    def create_user_list_mock(user_ids: list[str]) -> list[dict[str, str]]:
        """
        Create a list of user dictionaries for partial member list operations.

        Args:
            user_ids: List of user IDs to include

        Returns:
            List of user dictionaries with "user_id" keys
        """
        return [{"user_id": user_id} for user_id in user_ids]


# ============================================================================
# Tests for get_dataset_partial_member_list
# ============================================================================


class TestDatasetPermissionServiceGetPartialMemberList:
    """
    Comprehensive unit tests for DatasetPermissionService.get_dataset_partial_member_list method.

    This test class covers the retrieval of partial member lists for datasets,
    which returns a list of account IDs that have explicit permissions for
    a given dataset.

    The get_dataset_partial_member_list method:
    1. Queries DatasetPermission table for the dataset ID
    2. Selects account_id values
    3. Returns list of account IDs

    Test scenarios include:
    - Retrieving list with multiple members
    - Retrieving list with single member
    - Retrieving empty list (no partial members)
    - Database query validation
    """

    @pytest.fixture
    def mock_db_session(self):
        """
        Mock database session for testing.

        Provides a mocked database session that can be used to verify
        query construction and execution.
        """
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_dataset_partial_member_list_with_members(self, mock_db_session):
        """
        Test retrieving partial member list with multiple members.

        Verifies that when a dataset has multiple partial members, all
        account IDs are returned correctly.

        This test ensures:
        - Query is constructed correctly
        - All account IDs are returned
        - Database query is executed
        """
        # Arrange
        dataset_id = "dataset-123"
        expected_account_ids = ["user-456", "user-789", "user-012"]

        # Mock the scalars query to return account IDs
        mock_scalars_result = Mock()
        mock_scalars_result.all.return_value = expected_account_ids
        mock_db_session.scalars.return_value = mock_scalars_result

        # Act
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset_id)

        # Assert
        assert result == expected_account_ids
        assert len(result) == 3

        # Verify query was executed
        mock_db_session.scalars.assert_called_once()

    def test_get_dataset_partial_member_list_with_single_member(self, mock_db_session):
        """
        Test retrieving partial member list with single member.

        Verifies that when a dataset has only one partial member, the
        single account ID is returned correctly.

        This test ensures:
        - Query works correctly for single member
        - Result is a list with one element
        - Database query is executed
        """
        # Arrange
        dataset_id = "dataset-123"
        expected_account_ids = ["user-456"]

        # Mock the scalars query to return single account ID
        mock_scalars_result = Mock()
        mock_scalars_result.all.return_value = expected_account_ids
        mock_db_session.scalars.return_value = mock_scalars_result

        # Act
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset_id)

        # Assert
        assert result == expected_account_ids
        assert len(result) == 1

        # Verify query was executed
        mock_db_session.scalars.assert_called_once()

    def test_get_dataset_partial_member_list_empty(self, mock_db_session):
        """
        Test retrieving partial member list when no members exist.

        Verifies that when a dataset has no partial members, an empty
        list is returned.

        This test ensures:
        - Empty list is returned correctly
        - Query is executed even when no results
        - No errors are raised
        """
        # Arrange
        dataset_id = "dataset-123"

        # Mock the scalars query to return empty list
        mock_scalars_result = Mock()
        mock_scalars_result.all.return_value = []
        mock_db_session.scalars.return_value = mock_scalars_result

        # Act
        result = DatasetPermissionService.get_dataset_partial_member_list(dataset_id)

        # Assert
        assert result == []
        assert len(result) == 0

        # Verify query was executed
        mock_db_session.scalars.assert_called_once()


# ============================================================================
# Tests for update_partial_member_list
# ============================================================================


class TestDatasetPermissionServiceUpdatePartialMemberList:
    """
    Comprehensive unit tests for DatasetPermissionService.update_partial_member_list method.

    This test class covers the update of partial member lists for datasets,
    which replaces the existing partial member list with a new one.

    The update_partial_member_list method:
    1. Deletes all existing DatasetPermission records for the dataset
    2. Creates new DatasetPermission records for each user in the list
    3. Adds all new permissions to the session
    4. Commits the transaction
    5. Rolls back on error

    Test scenarios include:
    - Adding new partial members
    - Updating existing partial members
    - Replacing entire member list
    - Handling empty member list
    - Database transaction handling
    - Error handling and rollback
    """

    @pytest.fixture
    def mock_db_session(self):
        """
        Mock database session for testing.

        Provides a mocked database session that can be used to verify
        database operations including queries, adds, commits, and rollbacks.
        """
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_update_partial_member_list_add_new_members(self, mock_db_session):
        """
        Test adding new partial members to a dataset.

        Verifies that when updating with new members, the old members
        are deleted and new members are added correctly.

        This test ensures:
        - Old permissions are deleted
        - New permissions are created
        - All permissions are added to session
        - Transaction is committed
        """
        # Arrange
        tenant_id = "tenant-123"
        dataset_id = "dataset-123"
        user_list = DatasetPermissionTestDataFactory.create_user_list_mock(["user-456", "user-789"])

        # Mock the query delete operation
        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.delete.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act
        DatasetPermissionService.update_partial_member_list(tenant_id, dataset_id, user_list)

        # Assert
        # Verify old permissions were deleted
        mock_db_session.query.assert_called()
        mock_query.where.assert_called()

        # Verify new permissions were added
        mock_db_session.add_all.assert_called_once()

        # Verify transaction was committed
        mock_db_session.commit.assert_called_once()

        # Verify no rollback occurred
        mock_db_session.rollback.assert_not_called()

    def test_update_partial_member_list_replace_existing(self, mock_db_session):
        """
        Test replacing existing partial members with new ones.

        Verifies that when updating with a different member list, the
        old members are removed and new members are added.

        This test ensures:
        - Old permissions are deleted
        - New permissions replace old ones
        - Transaction is committed successfully
        """
        # Arrange
        tenant_id = "tenant-123"
        dataset_id = "dataset-123"
        user_list = DatasetPermissionTestDataFactory.create_user_list_mock(["user-999", "user-888"])

        # Mock the query delete operation
        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.delete.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act
        DatasetPermissionService.update_partial_member_list(tenant_id, dataset_id, user_list)

        # Assert
        # Verify old permissions were deleted
        mock_db_session.query.assert_called()

        # Verify new permissions were added
        mock_db_session.add_all.assert_called_once()

        # Verify transaction was committed
        mock_db_session.commit.assert_called_once()

    def test_update_partial_member_list_empty_list(self, mock_db_session):
        """
        Test updating with empty member list (clearing all members).

        Verifies that when updating with an empty list, all existing
        permissions are deleted and no new permissions are added.

        This test ensures:
        - Old permissions are deleted
        - No new permissions are added
        - Transaction is committed
        """
        # Arrange
        tenant_id = "tenant-123"
        dataset_id = "dataset-123"
        user_list = []

        # Mock the query delete operation
        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.delete.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act
        DatasetPermissionService.update_partial_member_list(tenant_id, dataset_id, user_list)

        # Assert
        # Verify old permissions were deleted
        mock_db_session.query.assert_called()

        # Verify add_all was called with empty list
        mock_db_session.add_all.assert_called_once_with([])

        # Verify transaction was committed
        mock_db_session.commit.assert_called_once()

    def test_update_partial_member_list_database_error_rollback(self, mock_db_session):
        """
        Test error handling and rollback on database error.

        Verifies that when a database error occurs during the update,
        the transaction is rolled back and the error is re-raised.

        This test ensures:
        - Error is caught and handled
        - Transaction is rolled back
        - Error is re-raised
        - No commit occurs after error
        """
        # Arrange
        tenant_id = "tenant-123"
        dataset_id = "dataset-123"
        user_list = DatasetPermissionTestDataFactory.create_user_list_mock(["user-456"])

        # Mock the query delete operation
        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.delete.return_value = None
        mock_db_session.query.return_value = mock_query

        # Mock commit to raise an error
        database_error = Exception("Database connection error")
        mock_db_session.commit.side_effect = database_error

        # Act & Assert
        with pytest.raises(Exception, match="Database connection error"):
            DatasetPermissionService.update_partial_member_list(tenant_id, dataset_id, user_list)

        # Verify rollback was called
        mock_db_session.rollback.assert_called_once()


# ============================================================================
# Tests for check_permission
# ============================================================================


class TestDatasetPermissionServiceCheckPermission:
    """
    Comprehensive unit tests for DatasetPermissionService.check_permission method.

    This test class covers the permission validation logic that ensures
    users have the appropriate permissions to modify dataset permissions.

    The check_permission method:
    1. Validates user is a dataset editor
    2. Checks if dataset operator is trying to change permissions
    3. Validates partial member list when setting to partial_members
    4. Ensures dataset operators cannot change permission levels
    5. Ensures dataset operators cannot modify partial member lists

    Test scenarios include:
    - Valid permission changes by dataset editors
    - Dataset operator restrictions
    - Partial member list validation
    - Missing dataset editor permissions
    - Invalid permission changes
    """

    @pytest.fixture
    def mock_get_partial_member_list(self):
        """
        Mock get_dataset_partial_member_list method.

        Provides a mocked version of the get_dataset_partial_member_list
        method for testing permission validation logic.
        """
        with patch.object(DatasetPermissionService, "get_dataset_partial_member_list") as mock_get_list:
            yield mock_get_list

    def test_check_permission_dataset_editor_success(self, mock_get_partial_member_list):
        """
        Test successful permission check for dataset editor.

        Verifies that when a dataset editor (not operator) tries to
        change permissions, the check passes.

        This test ensures:
        - Dataset editors can change permissions
        - No errors are raised for valid changes
        - Partial member list validation is skipped for non-operators
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(is_dataset_editor=True, is_dataset_operator=False)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(permission=DatasetPermissionEnum.ONLY_ME)
        requested_permission = DatasetPermissionEnum.ALL_TEAM
        requested_partial_member_list = None

        # Act (should not raise)
        DatasetPermissionService.check_permission(user, dataset, requested_permission, requested_partial_member_list)

        # Assert
        # Verify get_partial_member_list was not called (not needed for non-operators)
        mock_get_partial_member_list.assert_not_called()

    def test_check_permission_not_dataset_editor_error(self):
        """
        Test error when user is not a dataset editor.

        Verifies that when a user without dataset editor permissions
        tries to change permissions, a NoPermissionError is raised.

        This test ensures:
        - Non-editors cannot change permissions
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(is_dataset_editor=False)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock()
        requested_permission = DatasetPermissionEnum.ALL_TEAM
        requested_partial_member_list = None

        # Act & Assert
        with pytest.raises(NoPermissionError, match="User does not have permission to edit this dataset"):
            DatasetPermissionService.check_permission(
                user, dataset, requested_permission, requested_partial_member_list
            )

    def test_check_permission_operator_cannot_change_permission_error(self):
        """
        Test error when dataset operator tries to change permission level.

        Verifies that when a dataset operator tries to change the permission
        level, a NoPermissionError is raised.

        This test ensures:
        - Dataset operators cannot change permission levels
        - Error message is clear
        - Current permission is preserved
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(is_dataset_editor=True, is_dataset_operator=True)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(permission=DatasetPermissionEnum.ONLY_ME)
        requested_permission = DatasetPermissionEnum.ALL_TEAM  # Trying to change
        requested_partial_member_list = None

        # Act & Assert
        with pytest.raises(NoPermissionError, match="Dataset operators cannot change the dataset permissions"):
            DatasetPermissionService.check_permission(
                user, dataset, requested_permission, requested_partial_member_list
            )

    def test_check_permission_operator_partial_members_missing_list_error(self, mock_get_partial_member_list):
        """
        Test error when operator sets partial_members without providing list.

        Verifies that when a dataset operator tries to set permission to
        partial_members without providing a member list, a ValueError is raised.

        This test ensures:
        - Partial member list is required for partial_members permission
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(is_dataset_editor=True, is_dataset_operator=True)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(permission=DatasetPermissionEnum.PARTIAL_TEAM)
        requested_permission = "partial_members"
        requested_partial_member_list = None  # Missing list

        # Act & Assert
        with pytest.raises(ValueError, match="Partial member list is required when setting to partial members"):
            DatasetPermissionService.check_permission(
                user, dataset, requested_permission, requested_partial_member_list
            )

    def test_check_permission_operator_cannot_modify_partial_list_error(self, mock_get_partial_member_list):
        """
        Test error when operator tries to modify partial member list.

        Verifies that when a dataset operator tries to change the partial
        member list, a ValueError is raised.

        This test ensures:
        - Dataset operators cannot modify partial member lists
        - Error message is clear
        - Current member list is preserved
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(is_dataset_editor=True, is_dataset_operator=True)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(permission=DatasetPermissionEnum.PARTIAL_TEAM)
        requested_permission = "partial_members"

        # Current member list
        current_member_list = ["user-456", "user-789"]
        mock_get_partial_member_list.return_value = current_member_list

        # Requested member list (different from current)
        requested_partial_member_list = DatasetPermissionTestDataFactory.create_user_list_mock(
            ["user-456", "user-999"]  # Different list
        )

        # Act & Assert
        with pytest.raises(ValueError, match="Dataset operators cannot change the dataset permissions"):
            DatasetPermissionService.check_permission(
                user, dataset, requested_permission, requested_partial_member_list
            )

    def test_check_permission_operator_can_keep_same_partial_list(self, mock_get_partial_member_list):
        """
        Test that operator can keep the same partial member list.

        Verifies that when a dataset operator keeps the same partial member
        list, the check passes.

        This test ensures:
        - Operators can keep existing partial member lists
        - No errors are raised for unchanged lists
        - Permission validation works correctly
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(is_dataset_editor=True, is_dataset_operator=True)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(permission=DatasetPermissionEnum.PARTIAL_TEAM)
        requested_permission = "partial_members"

        # Current member list
        current_member_list = ["user-456", "user-789"]
        mock_get_partial_member_list.return_value = current_member_list

        # Requested member list (same as current)
        requested_partial_member_list = DatasetPermissionTestDataFactory.create_user_list_mock(
            ["user-456", "user-789"]  # Same list
        )

        # Act (should not raise)
        DatasetPermissionService.check_permission(user, dataset, requested_permission, requested_partial_member_list)

        # Assert
        # Verify get_partial_member_list was called to compare lists
        mock_get_partial_member_list.assert_called_once_with(dataset.id)


# ============================================================================
# Tests for clear_partial_member_list
# ============================================================================


class TestDatasetPermissionServiceClearPartialMemberList:
    """
    Comprehensive unit tests for DatasetPermissionService.clear_partial_member_list method.

    This test class covers the clearing of partial member lists, which removes
    all DatasetPermission records for a given dataset.

    The clear_partial_member_list method:
    1. Deletes all DatasetPermission records for the dataset
    2. Commits the transaction
    3. Rolls back on error

    Test scenarios include:
    - Clearing list with existing members
    - Clearing empty list (no members)
    - Database transaction handling
    - Error handling and rollback
    """

    @pytest.fixture
    def mock_db_session(self):
        """
        Mock database session for testing.

        Provides a mocked database session that can be used to verify
        database operations including queries, deletes, commits, and rollbacks.
        """
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_clear_partial_member_list_success(self, mock_db_session):
        """
        Test successful clearing of partial member list.

        Verifies that when clearing a partial member list, all permissions
        are deleted and the transaction is committed.

        This test ensures:
        - All permissions are deleted
        - Transaction is committed
        - No errors are raised
        """
        # Arrange
        dataset_id = "dataset-123"

        # Mock the query delete operation
        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.delete.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act
        DatasetPermissionService.clear_partial_member_list(dataset_id)

        # Assert
        # Verify query was executed
        mock_db_session.query.assert_called()

        # Verify delete was called
        mock_query.where.assert_called()
        mock_query.delete.assert_called_once()

        # Verify transaction was committed
        mock_db_session.commit.assert_called_once()

        # Verify no rollback occurred
        mock_db_session.rollback.assert_not_called()

    def test_clear_partial_member_list_empty_list(self, mock_db_session):
        """
        Test clearing partial member list when no members exist.

        Verifies that when clearing an already empty list, the operation
        completes successfully without errors.

        This test ensures:
        - Operation works correctly for empty lists
        - Transaction is committed
        - No errors are raised
        """
        # Arrange
        dataset_id = "dataset-123"

        # Mock the query delete operation
        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.delete.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act
        DatasetPermissionService.clear_partial_member_list(dataset_id)

        # Assert
        # Verify query was executed
        mock_db_session.query.assert_called()

        # Verify transaction was committed
        mock_db_session.commit.assert_called_once()

    def test_clear_partial_member_list_database_error_rollback(self, mock_db_session):
        """
        Test error handling and rollback on database error.

        Verifies that when a database error occurs during clearing,
        the transaction is rolled back and the error is re-raised.

        This test ensures:
        - Error is caught and handled
        - Transaction is rolled back
        - Error is re-raised
        - No commit occurs after error
        """
        # Arrange
        dataset_id = "dataset-123"

        # Mock the query delete operation
        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.delete.return_value = None
        mock_db_session.query.return_value = mock_query

        # Mock commit to raise an error
        database_error = Exception("Database connection error")
        mock_db_session.commit.side_effect = database_error

        # Act & Assert
        with pytest.raises(Exception, match="Database connection error"):
            DatasetPermissionService.clear_partial_member_list(dataset_id)

        # Verify rollback was called
        mock_db_session.rollback.assert_called_once()


# ============================================================================
# Tests for DatasetService.check_dataset_permission
# ============================================================================


class TestDatasetServiceCheckDatasetPermission:
    """
    Comprehensive unit tests for DatasetService.check_dataset_permission method.

    This test class covers the dataset permission checking logic that validates
    whether a user has access to a dataset based on permission enums.

    The check_dataset_permission method:
    1. Validates tenant match
    2. Checks OWNER role (bypasses some restrictions)
    3. Validates only_me permission (creator only)
    4. Validates partial_members permission (explicit permission required)
    5. Validates all_team_members permission (all tenant members)

    Test scenarios include:
    - Tenant boundary enforcement
    - OWNER role bypass
    - only_me permission validation
    - partial_members permission validation
    - all_team_members permission validation
    - Permission denial scenarios
    """

    @pytest.fixture
    def mock_db_session(self):
        """
        Mock database session for testing.

        Provides a mocked database session that can be used to verify
        database queries for permission checks.
        """
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_check_dataset_permission_owner_bypass(self, mock_db_session):
        """
        Test that OWNER role bypasses permission checks.

        Verifies that when a user has OWNER role, they can access any
        dataset in their tenant regardless of permission level.

        This test ensures:
        - OWNER role bypasses permission restrictions
        - No database queries are needed for OWNER
        - Access is granted automatically
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(role=TenantAccountRole.OWNER, tenant_id="tenant-123")
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="other-user-123",  # Not the current user
        )

        # Act (should not raise)
        DatasetService.check_dataset_permission(dataset, user)

        # Assert
        # Verify no permission queries were made (OWNER bypasses)
        mock_db_session.query.assert_not_called()

    def test_check_dataset_permission_tenant_mismatch_error(self):
        """
        Test error when user and dataset are in different tenants.

        Verifies that when a user tries to access a dataset from a different
        tenant, a NoPermissionError is raised.

        This test ensures:
        - Tenant boundary is enforced
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(tenant_id="tenant-123")
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(tenant_id="tenant-456")  # Different tenant

        # Act & Assert
        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset"):
            DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_permission_only_me_creator_success(self):
        """
        Test that creator can access only_me dataset.

        Verifies that when a user is the creator of an only_me dataset,
        they can access it successfully.

        This test ensures:
        - Creators can access their own only_me datasets
        - No explicit permission record is needed
        - Access is granted correctly
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(user_id="user-123", role=TenantAccountRole.NORMAL)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="user-123",  # User is the creator
        )

        # Act (should not raise)
        DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_permission_only_me_non_creator_error(self):
        """
        Test error when non-creator tries to access only_me dataset.

        Verifies that when a user who is not the creator tries to access
        an only_me dataset, a NoPermissionError is raised.

        This test ensures:
        - Non-creators cannot access only_me datasets
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(user_id="user-123", role=TenantAccountRole.NORMAL)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="other-user-456",  # Different creator
        )

        # Act & Assert
        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset"):
            DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_permission_partial_members_with_permission_success(self, mock_db_session):
        """
        Test that user with explicit permission can access partial_members dataset.

        Verifies that when a user has an explicit DatasetPermission record
        for a partial_members dataset, they can access it successfully.

        This test ensures:
        - Explicit permissions are checked correctly
        - Users with permissions can access
        - Database query is executed
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(user_id="user-123", role=TenantAccountRole.NORMAL)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="other-user-456",  # Not the creator
        )

        # Mock permission query to return permission record
        mock_permission = DatasetPermissionTestDataFactory.create_dataset_permission_mock(
            dataset_id=dataset.id, account_id=user.id
        )
        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = mock_permission
        mock_db_session.query.return_value = mock_query

        # Act (should not raise)
        DatasetService.check_dataset_permission(dataset, user)

        # Assert
        # Verify permission query was executed
        mock_db_session.query.assert_called()

    def test_check_dataset_permission_partial_members_without_permission_error(self, mock_db_session):
        """
        Test error when user without permission tries to access partial_members dataset.

        Verifies that when a user does not have an explicit DatasetPermission
        record for a partial_members dataset, a NoPermissionError is raised.

        This test ensures:
        - Missing permissions are detected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(user_id="user-123", role=TenantAccountRole.NORMAL)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="other-user-456",  # Not the creator
        )

        # Mock permission query to return None (no permission)
        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None  # No permission found
        mock_db_session.query.return_value = mock_query

        # Act & Assert
        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset"):
            DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_permission_partial_members_creator_success(self, mock_db_session):
        """
        Test that creator can access partial_members dataset without explicit permission.

        Verifies that when a user is the creator of a partial_members dataset,
        they can access it even without an explicit DatasetPermission record.

        This test ensures:
        - Creators can access their own datasets
        - No explicit permission record is needed for creators
        - Access is granted correctly
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(user_id="user-123", role=TenantAccountRole.NORMAL)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="user-123",  # User is the creator
        )

        # Act (should not raise)
        DatasetService.check_dataset_permission(dataset, user)

        # Assert
        # Verify permission query was not executed (creator bypasses)
        mock_db_session.query.assert_not_called()

    def test_check_dataset_permission_all_team_members_success(self):
        """
        Test that any tenant member can access all_team_members dataset.

        Verifies that when a dataset has all_team_members permission, any
        user in the same tenant can access it.

        This test ensures:
        - All team members can access
        - No explicit permission record is needed
        - Access is granted correctly
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(user_id="user-123", role=TenantAccountRole.NORMAL)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ALL_TEAM,
            created_by="other-user-456",  # Not the creator
        )

        # Act (should not raise)
        DatasetService.check_dataset_permission(dataset, user)


# ============================================================================
# Tests for DatasetService.check_dataset_operator_permission
# ============================================================================


class TestDatasetServiceCheckDatasetOperatorPermission:
    """
    Comprehensive unit tests for DatasetService.check_dataset_operator_permission method.

    This test class covers the dataset operator permission checking logic,
    which validates whether a dataset operator has access to a dataset.

    The check_dataset_operator_permission method:
    1. Validates dataset exists
    2. Validates user exists
    3. Checks OWNER role (bypasses restrictions)
    4. Validates only_me permission (creator only)
    5. Validates partial_members permission (explicit permission required)

    Test scenarios include:
    - Dataset not found error
    - User not found error
    - OWNER role bypass
    - only_me permission validation
    - partial_members permission validation
    - Permission denial scenarios
    """

    @pytest.fixture
    def mock_db_session(self):
        """
        Mock database session for testing.

        Provides a mocked database session that can be used to verify
        database queries for permission checks.
        """
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_check_dataset_operator_permission_dataset_not_found_error(self):
        """
        Test error when dataset is None.

        Verifies that when dataset is None, a ValueError is raised.

        This test ensures:
        - Dataset existence is validated
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock()
        dataset = None

        # Act & Assert
        with pytest.raises(ValueError, match="Dataset not found"):
            DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

    def test_check_dataset_operator_permission_user_not_found_error(self):
        """
        Test error when user is None.

        Verifies that when user is None, a ValueError is raised.

        This test ensures:
        - User existence is validated
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        user = None
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="User not found"):
            DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

    def test_check_dataset_operator_permission_owner_bypass(self):
        """
        Test that OWNER role bypasses permission checks.

        Verifies that when a user has OWNER role, they can access any
        dataset in their tenant regardless of permission level.

        This test ensures:
        - OWNER role bypasses permission restrictions
        - No database queries are needed for OWNER
        - Access is granted automatically
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(role=TenantAccountRole.OWNER, tenant_id="tenant-123")
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="other-user-123",  # Not the current user
        )

        # Act (should not raise)
        DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

    def test_check_dataset_operator_permission_only_me_creator_success(self):
        """
        Test that creator can access only_me dataset.

        Verifies that when a user is the creator of an only_me dataset,
        they can access it successfully.

        This test ensures:
        - Creators can access their own only_me datasets
        - No explicit permission record is needed
        - Access is granted correctly
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(user_id="user-123", role=TenantAccountRole.NORMAL)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="user-123",  # User is the creator
        )

        # Act (should not raise)
        DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

    def test_check_dataset_operator_permission_only_me_non_creator_error(self):
        """
        Test error when non-creator tries to access only_me dataset.

        Verifies that when a user who is not the creator tries to access
        an only_me dataset, a NoPermissionError is raised.

        This test ensures:
        - Non-creators cannot access only_me datasets
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(user_id="user-123", role=TenantAccountRole.NORMAL)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="other-user-456",  # Different creator
        )

        # Act & Assert
        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset"):
            DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

    def test_check_dataset_operator_permission_partial_members_with_permission_success(self, mock_db_session):
        """
        Test that user with explicit permission can access partial_members dataset.

        Verifies that when a user has an explicit DatasetPermission record
        for a partial_members dataset, they can access it successfully.

        This test ensures:
        - Explicit permissions are checked correctly
        - Users with permissions can access
        - Database query is executed
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(user_id="user-123", role=TenantAccountRole.NORMAL)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="other-user-456",  # Not the creator
        )

        # Mock permission query to return permission records
        mock_permission = DatasetPermissionTestDataFactory.create_dataset_permission_mock(
            dataset_id=dataset.id, account_id=user.id
        )
        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.all.return_value = [mock_permission]  # User has permission
        mock_db_session.query.return_value = mock_query

        # Act (should not raise)
        DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

        # Assert
        # Verify permission query was executed
        mock_db_session.query.assert_called()

    def test_check_dataset_operator_permission_partial_members_without_permission_error(self, mock_db_session):
        """
        Test error when user without permission tries to access partial_members dataset.

        Verifies that when a user does not have an explicit DatasetPermission
        record for a partial_members dataset, a NoPermissionError is raised.

        This test ensures:
        - Missing permissions are detected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        user = DatasetPermissionTestDataFactory.create_user_mock(user_id="user-123", role=TenantAccountRole.NORMAL)
        dataset = DatasetPermissionTestDataFactory.create_dataset_mock(
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="other-user-456",  # Not the creator
        )

        # Mock permission query to return empty list (no permission)
        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.all.return_value = []  # No permissions found
        mock_db_session.query.return_value = mock_query

        # Act & Assert
        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset"):
            DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)


# ============================================================================
# Additional Documentation and Notes
# ============================================================================
#
# This test suite covers the core permission management operations for datasets.
# Additional test scenarios that could be added:
#
# 1. Permission Enum Transitions:
#    - Testing transitions between permission levels
#    - Testing validation during transitions
#    - Testing partial member list updates during transitions
#
# 2. Bulk Operations:
#    - Testing bulk permission updates
#    - Testing bulk partial member list updates
#    - Testing performance with large member lists
#
# 3. Edge Cases:
#    - Testing with very large partial member lists
#    - Testing with special characters in user IDs
#    - Testing with deleted users
#    - Testing with inactive permissions
#
# 4. Integration Scenarios:
#    - Testing permission changes followed by access attempts
#    - Testing concurrent permission updates
#    - Testing permission inheritance
#
# These scenarios are not currently implemented but could be added if needed
# based on real-world usage patterns or discovered edge cases.
#
# ============================================================================
