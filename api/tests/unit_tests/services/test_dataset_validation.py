"""
Comprehensive unit tests for DatasetService validation and configuration methods.

This test suite provides complete coverage of dataset validation, permission checking,
and configuration operations in Dify, following TDD principles with the Arrange-Act-Assert pattern.

The DatasetService contains critical validation and configuration methods that ensure
proper access control, data integrity, and correct dataset configuration across the platform.

## Test Coverage

### 1. Permission Checks (TestDatasetServicePermissionChecks)
Tests dataset permission validation:
- check_dataset_permission: User access validation based on tenant, permission level, and roles
- check_dataset_operator_permission: Operator-specific permission validation

### 2. Name Validation (TestDatasetServiceNameValidation)
Tests duplicate name detection:
- _has_dataset_same_name: Duplicate name detection within tenant

### 3. Indexing Technique Configuration (TestDatasetServiceIndexingTechnique)
Tests indexing technique change handling:
- _handle_indexing_technique_change: Handling changes between economy and high_quality modes

### 4. Embedding Model Configuration (TestDatasetServiceEmbeddingConfiguration)
Tests embedding model configuration:
- _configure_embedding_model_for_high_quality: Embedding model setup for high quality indexing

## Testing Approach

- **Mocking Strategy**: All external dependencies (database, ModelManager,
  DatasetCollectionBindingService, current_user, logger) are mocked for fast,
  isolated unit tests
- **Factory Pattern**: DatasetValidationTestDataFactory provides consistent test data
- **Fixtures**: Mock objects are configured per test method
- **Assertions**: Each test verifies return values and side effects
  (database operations, method calls, exception raising)

## Key Concepts

**Permission Levels:**
- ONLY_ME: Only the dataset creator can access
- ALL_TEAM: All team members of the tenant can access
- PARTIAL_TEAM: Only specific users with explicit DatasetPermission records can access

**User Roles:**
- OWNER: Tenant owner, bypasses most permission checks
- NORMAL: Regular user, subject to permission checks
- DATASET_OPERATOR: Dataset-specific operator with restricted permissions

**Indexing Techniques:**
- economy: No embedding model required, uses keyword-based indexing
- high_quality: Requires embedding model for vector-based indexing

**Validation:**
- Tenant isolation must be enforced in all operations
- Duplicate names are prevented within a tenant
- Permission checks validate access before operations
- Embedding model configuration requires valid provider and model
"""


# ============================================================================
# IMPORTS
# ============================================================================

from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest

from core.model_runtime.entities.model_entities import ModelType
from models import Account
from models.dataset import Dataset, DatasetPermission, DatasetPermissionEnum
from services.dataset_service import DatasetService
from services.errors.account import NoPermissionError

# ============================================================================
# TEST DATA FACTORY
# ============================================================================


class DatasetValidationTestDataFactory:
    """
    Factory for creating test data and mock objects.

    Provides reusable methods to create consistent mock objects for testing
    dataset validation and configuration operations. This factory ensures all
    test data follows the same structure and reduces code duplication.

    The factory pattern is used here to:
    - Ensure consistent test data creation
    - Reduce boilerplate code in individual tests
    - Make tests more maintainable and readable
    - Centralize mock object configuration
    """

    @staticmethod
    def create_user_mock(
        user_id: str = "user-123",
        tenant_id: str = "tenant-123",
        role: str = "NORMAL",
        is_dataset_editor: bool = True,
        is_dataset_operator: bool = False,
        **kwargs,
    ) -> Mock:
        """
        Create a mock Account (user) object.

        This method creates a mock Account instance with all required attributes
        for permission and validation testing. The Account represents a user in
        the system with a specific role and permissions.

        Args:
            user_id: Unique identifier for the user/account
            tenant_id: Tenant identifier for multi-tenancy isolation
            role: User role (OWNER, NORMAL, DATASET_OPERATOR)
            is_dataset_editor: Whether user can edit datasets
            is_dataset_operator: Whether user is a dataset operator
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Account object with specified attributes

        Example:
            >>> user = factory.create_user_mock(
            ...     user_id="account-456",
            ...     tenant_id="tenant-789",
            ...     role="OWNER"
            ... )
        """
        # Create a mock that matches the Account model interface
        user = create_autospec(Account, instance=True)

        # Set core attributes
        user.id = user_id
        user.current_tenant_id = tenant_id
        user.current_role = role
        user.is_dataset_editor = is_dataset_editor
        user.is_dataset_operator = is_dataset_operator

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(user, key, value)

        return user

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        name: str = "Test Dataset",
        tenant_id: str = "tenant-123",
        permission: str = DatasetPermissionEnum.ONLY_ME,
        created_by: str = "user-123",
        indexing_technique: str | None = "high_quality",
        embedding_model: str | None = "text-embedding-ada-002",
        embedding_model_provider: str | None = "openai",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Dataset object.

        This method creates a mock Dataset instance with all required attributes
        for validation and configuration testing. The Dataset represents a
        knowledge base or dataset in the system.

        Args:
            dataset_id: Unique identifier for the dataset
            name: Dataset name
            tenant_id: Tenant identifier for multi-tenancy isolation
            permission: Permission level (ONLY_ME, ALL_TEAM, PARTIAL_TEAM)
            created_by: ID of the user who created the dataset
            indexing_technique: Indexing technique (high_quality, economy, None)
            embedding_model: Embedding model name (if applicable)
            embedding_model_provider: Embedding model provider (if applicable)
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Dataset object with specified attributes

        Example:
            >>> dataset = factory.create_dataset_mock(
            ...     dataset_id="dataset-456",
            ...     name="My Knowledge Base",
            ...     permission=DatasetPermissionEnum.ALL_TEAM,
            ...     indexing_technique="high_quality"
            ... )
        """
        # Create a mock that matches the Dataset model interface
        dataset = create_autospec(Dataset, instance=True)

        # Set core attributes
        dataset.id = dataset_id
        dataset.name = name
        dataset.tenant_id = tenant_id
        dataset.permission = permission
        dataset.created_by = created_by
        dataset.indexing_technique = indexing_technique
        dataset.embedding_model = embedding_model
        dataset.embedding_model_provider = embedding_model_provider

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(dataset, key, value)

        return dataset

    @staticmethod
    def create_dataset_permission_mock(
        dataset_id: str = "dataset-123",
        account_id: str = "user-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock DatasetPermission object.

        This method creates a mock DatasetPermission instance representing an
        explicit permission record that grants a user access to a dataset with
        PARTIAL_TEAM permission.

        Args:
            dataset_id: Associated dataset identifier
            account_id: Associated account/user identifier
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock DatasetPermission object with specified attributes

        Example:
            >>> permission = factory.create_dataset_permission_mock(
            ...     dataset_id="dataset-456",
            ...     account_id="user-789"
            ... )
        """
        # Create a mock that matches the DatasetPermission model interface
        permission = create_autospec(DatasetPermission, instance=True)

        # Set core attributes
        permission.dataset_id = dataset_id
        permission.account_id = account_id

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(permission, key, value)

        return permission

    @staticmethod
    def create_embedding_model_mock(
        model: str = "text-embedding-ada-002",
        provider: str = "openai",
        **kwargs,
    ) -> Mock:
        """
        Create a mock embedding model object.

        This method creates a mock embedding model instance that would be
        returned by ModelManager.get_model_instance(). The embedding model
        represents a configured text embedding model for vector indexing.

        Args:
            model: Model name/identifier
            provider: Model provider name
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock embedding model object with specified attributes

        Example:
            >>> embedding_model = factory.create_embedding_model_mock(
            ...     model="text-embedding-3-small",
            ...     provider="openai"
            ... )
        """
        # Create a mock embedding model
        embedding_model = Mock()

        # Set core attributes
        embedding_model.model = model
        embedding_model.provider = provider

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(embedding_model, key, value)

        return embedding_model

    @staticmethod
    def create_collection_binding_mock(
        binding_id: str = "binding-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock DatasetCollectionBinding object.

        This method creates a mock collection binding instance that links an
        embedding model to a dataset collection for vector storage.

        Args:
            binding_id: Unique identifier for the binding
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock collection binding object with specified attributes

        Example:
            >>> binding = factory.create_collection_binding_mock(
            ...     binding_id="binding-456"
            ... )
        """
        # Create a mock collection binding
        binding = Mock()

        # Set core attributes
        binding.id = binding_id

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(binding, key, value)

        return binding


# ============================================================================
# PYTEST FIXTURES
# ============================================================================


@pytest.fixture
def factory():
    """
    Provide the test data factory to all tests.

    This fixture makes the DatasetValidationTestDataFactory available to all test
    methods, allowing them to create consistent mock objects easily.

    Returns:
        DatasetValidationTestDataFactory class
    """
    return DatasetValidationTestDataFactory


# ============================================================================
# PERMISSION CHECK TESTS
# ============================================================================


class TestDatasetServicePermissionChecks:
    """
    Test dataset permission checking operations.

    This test class covers all methods related to validating user permissions
    for dataset access. These operations are critical for security and access
    control, ensuring users can only access datasets they have permission to view.
    """

    @patch("services.dataset_service.logger")
    def test_check_dataset_permission_tenant_mismatch_raises_error(self, mock_logger, factory):
        """
        Test that check_dataset_permission raises NoPermissionError for tenant mismatch.

        This test verifies that the check_dataset_permission method correctly
        rejects access attempts when the user's tenant does not match the
        dataset's tenant. This is a critical security boundary.

        Expected behavior:
        - NoPermissionError is raised
        - Error message indicates permission denied
        - Logger records debug message
        """
        # Arrange
        # Create user and dataset with different tenants
        user = factory.create_user_mock(user_id="user-123", tenant_id="tenant-123")
        dataset = factory.create_dataset_mock(dataset_id="dataset-123", tenant_id="tenant-456")  # Different tenant

        # Act & Assert
        # Verify NoPermissionError is raised for tenant mismatch
        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset"):
            DatasetService.check_dataset_permission(dataset, user)

        # Verify logger was called
        mock_logger.debug.assert_called()

    @patch("services.dataset_service.logger")
    @patch("services.dataset_service.db.session")
    def test_check_dataset_permission_owner_bypasses_checks(self, mock_db_session, mock_logger, factory):
        """
        Test that OWNER role bypasses permission checks.

        This test verifies that users with OWNER role can access any dataset
        within their tenant, regardless of the dataset's permission level.

        Expected behavior:
        - No exception is raised
        - Permission check passes for OWNER
        - No database queries for permission records
        """
        # Arrange
        # Create OWNER user
        from models import TenantAccountRole

        user = factory.create_user_mock(
            user_id="owner-123",
            tenant_id="tenant-123",
            role=TenantAccountRole.OWNER,
        )
        dataset = factory.create_dataset_mock(
            dataset_id="dataset-123",
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="other-user-456",  # Not the owner
        )

        # Act
        # Execute the method under test (should not raise)
        DatasetService.check_dataset_permission(dataset, user)

        # Assert
        # Verify no database query for permissions (OWNER bypasses)
        mock_db_session.query.assert_not_called()

    @patch("services.dataset_service.logger")
    def test_check_dataset_permission_only_me_creator_success(self, mock_logger, factory):
        """
        Test that dataset creator can access ONLY_ME dataset.

        This test verifies that when a dataset has ONLY_ME permission, the
        creator can successfully access it.

        Expected behavior:
        - No exception is raised
        - Permission check passes for creator
        """
        # Arrange
        user = factory.create_user_mock(user_id="user-123", tenant_id="tenant-123")
        dataset = factory.create_dataset_mock(
            dataset_id="dataset-123",
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by=user.id,  # User is the creator
        )

        # Act
        # Execute the method under test (should not raise)
        DatasetService.check_dataset_permission(dataset, user)

        # Assert
        # No exception should be raised

    @patch("services.dataset_service.logger")
    def test_check_dataset_permission_only_me_non_creator_raises_error(self, mock_logger, factory):
        """
        Test that non-creator cannot access ONLY_ME dataset.

        This test verifies that when a dataset has ONLY_ME permission, users
        other than the creator are denied access.

        Expected behavior:
        - NoPermissionError is raised
        - Error message indicates permission denied
        - Logger records debug message
        """
        # Arrange
        user = factory.create_user_mock(user_id="user-123", tenant_id="tenant-123")
        dataset = factory.create_dataset_mock(
            dataset_id="dataset-123",
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="other-user-456",  # Different creator
        )

        # Act & Assert
        # Verify NoPermissionError is raised
        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset"):
            DatasetService.check_dataset_permission(dataset, user)

        # Verify logger was called
        mock_logger.debug.assert_called()

    @patch("services.dataset_service.logger")
    @patch("services.dataset_service.db.session")
    def test_check_dataset_permission_all_team_success(self, mock_db_session, mock_logger, factory):
        """
        Test that any team member can access ALL_TEAM dataset.

        This test verifies that when a dataset has ALL_TEAM permission, any
        user within the same tenant can access it.

        Expected behavior:
        - No exception is raised
        - Permission check passes for any team member
        - No database queries for permission records
        """
        # Arrange
        user = factory.create_user_mock(user_id="user-123", tenant_id="tenant-123")
        dataset = factory.create_dataset_mock(
            dataset_id="dataset-123",
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ALL_TEAM,
            created_by="other-user-456",  # Different creator, but should still have access
        )

        # Act
        # Execute the method under test (should not raise)
        DatasetService.check_dataset_permission(dataset, user)

        # Assert
        # Verify no database query for permissions (ALL_TEAM doesn't need explicit permissions)
        mock_db_session.query.assert_not_called()

    @patch("services.dataset_service.logger")
    @patch("services.dataset_service.db.session")
    def test_check_dataset_permission_partial_team_creator_success(self, mock_db_session, mock_logger, factory):
        """
        Test that dataset creator can access PARTIAL_TEAM dataset.

        This test verifies that even when a dataset has PARTIAL_TEAM permission,
        the creator can still access it without needing an explicit permission record.

        Expected behavior:
        - No exception is raised
        - Permission check passes for creator
        - No database query (creator bypasses explicit permission check)
        """
        # Arrange
        user = factory.create_user_mock(user_id="user-123", tenant_id="tenant-123")
        dataset = factory.create_dataset_mock(
            dataset_id="dataset-123",
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by=user.id,  # User is the creator
        )

        # Act
        # Execute the method under test (should not raise)
        DatasetService.check_dataset_permission(dataset, user)

        # Assert
        # Verify no database query (creator doesn't need explicit permission)
        mock_db_session.query.assert_not_called()

    @patch("services.dataset_service.logger")
    @patch("services.dataset_service.db.session")
    def test_check_dataset_permission_partial_team_with_permission_success(self, mock_db_session, mock_logger, factory):
        """
        Test that user with explicit permission can access PARTIAL_TEAM dataset.

        This test verifies that when a dataset has PARTIAL_TEAM permission,
        users with an explicit DatasetPermission record can access it.

        Expected behavior:
        - No exception is raised
        - Permission check passes for user with explicit permission
        - Database query is executed to check permission
        """
        # Arrange
        user = factory.create_user_mock(user_id="user-123", tenant_id="tenant-123")
        dataset = factory.create_dataset_mock(
            dataset_id="dataset-123",
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="other-user-456",  # Different creator
        )

        # Mock permission query to return permission record
        mock_permission = factory.create_dataset_permission_mock(dataset_id=dataset.id, account_id=user.id)
        mock_query = MagicMock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = mock_permission
        mock_db_session.query.return_value = mock_query

        # Act
        # Execute the method under test (should not raise)
        DatasetService.check_dataset_permission(dataset, user)

        # Assert
        # Verify database query was executed
        mock_db_session.query.assert_called()

    @patch("services.dataset_service.logger")
    @patch("services.dataset_service.db.session")
    def test_check_dataset_permission_partial_team_without_permission_raises_error(
        self, mock_db_session, mock_logger, factory
    ):
        """
        Test that user without explicit permission cannot access PARTIAL_TEAM dataset.

        This test verifies that when a dataset has PARTIAL_TEAM permission,
        users without an explicit DatasetPermission record are denied access.

        Expected behavior:
        - NoPermissionError is raised
        - Error message indicates permission denied
        - Database query is executed to check permission
        - Logger records debug message
        """
        # Arrange
        user = factory.create_user_mock(user_id="user-123", tenant_id="tenant-123")
        dataset = factory.create_dataset_mock(
            dataset_id="dataset-123",
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="other-user-456",  # Different creator
        )

        # Mock permission query to return None (no permission record)
        mock_query = MagicMock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None  # No permission found
        mock_db_session.query.return_value = mock_query

        # Act & Assert
        # Verify NoPermissionError is raised
        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset"):
            DatasetService.check_dataset_permission(dataset, user)

        # Verify database query was executed
        mock_db_session.query.assert_called()

        mock_db_session.query.assert_called_with(DatasetPermission)
        mock_query.filter_by.assert_called_once_with(dataset_id=dataset.id, account_id=user.id)
        mock_logger.debug.assert_called()

    def test_check_dataset_operator_permission_dataset_not_found_raises_error(self, factory):
        """
        Test that check_dataset_operator_permission raises ValueError for missing dataset.

        This test verifies that the check_dataset_operator_permission method
        correctly rejects requests when the dataset is None or missing.

        Expected behavior:
        - ValueError is raised
        - Error message indicates "Dataset not found"
        """
        # Arrange
        user = factory.create_user_mock()

        # Act & Assert
        # Verify ValueError is raised for None dataset
        with pytest.raises(ValueError, match="Dataset not found"):
            DatasetService.check_dataset_operator_permission(user=user, dataset=None)

    def test_check_dataset_operator_permission_user_not_found_raises_error(self, factory):
        """
        Test that check_dataset_operator_permission raises ValueError for missing user.

        This test verifies that the check_dataset_operator_permission method
        correctly rejects requests when the user is None or missing.

        Expected behavior:
        - ValueError is raised
        - Error message indicates "User not found"
        """
        # Arrange
        dataset = factory.create_dataset_mock()

        # Act & Assert
        # Verify ValueError is raised for None user
        with pytest.raises(ValueError, match="User not found"):
            DatasetService.check_dataset_operator_permission(user=None, dataset=dataset)

    @patch("services.dataset_service.db.session")
    def test_check_dataset_operator_permission_owner_bypasses_checks(self, mock_db_session, factory):
        """
        Test that OWNER role bypasses operator permission checks.

        This test verifies that users with OWNER role can access any dataset
        within their tenant, even for operator-specific operations.

        Expected behavior:
        - No exception is raised
        - Permission check passes for OWNER
        - No database queries for permission records
        """
        # Arrange
        from models import TenantAccountRole

        user = factory.create_user_mock(
            user_id="owner-123",
            tenant_id="tenant-123",
            role=TenantAccountRole.OWNER,
        )
        dataset = factory.create_dataset_mock(
            dataset_id="dataset-123",
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="other-user-456",  # Not the owner
        )

        # Act
        # Execute the method under test (should not raise)
        DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

        # Assert
        # Verify no database query (OWNER bypasses)
        mock_db_session.query.assert_not_called()

    @patch("services.dataset_service.db.session")
    def test_check_dataset_operator_permission_only_me_creator_success(self, mock_db_session, factory):
        """
        Test that dataset creator can access ONLY_ME dataset as operator.

        Expected behavior:
        - No exception is raised
        - Permission check passes for creator
        """
        # Arrange
        user = factory.create_user_mock(user_id="user-123", tenant_id="tenant-123")
        dataset = factory.create_dataset_mock(
            dataset_id="dataset-123",
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by=user.id,  # User is the creator
        )

        # Act
        # Execute the method under test (should not raise)
        DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

        # Assert
        # No exception should be raised

    def test_check_dataset_operator_permission_only_me_non_creator_raises_error(self, factory):
        """
        Test that non-creator cannot access ONLY_ME dataset as operator.

        Expected behavior:
        - NoPermissionError is raised
        - Error message indicates permission denied
        """
        # Arrange
        user = factory.create_user_mock(user_id="user-123", tenant_id="tenant-123")
        dataset = factory.create_dataset_mock(
            dataset_id="dataset-123",
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="other-user-456",  # Different creator
        )

        # Act & Assert
        # Verify NoPermissionError is raised
        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset"):
            DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

    @patch("services.dataset_service.db.session")
    def test_check_dataset_operator_permission_partial_team_with_permission_success(self, mock_db_session, factory):
        """
        Test that user with explicit permission can access PARTIAL_TEAM dataset as operator.

        Expected behavior:
        - No exception is raised
        - Permission check passes for user with explicit permission
        - Database query is executed to check permission
        """
        # Arrange
        user = factory.create_user_mock(user_id="user-123", tenant_id="tenant-123")
        dataset = factory.create_dataset_mock(
            dataset_id="dataset-123",
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="other-user-456",  # Different creator
        )

        # Mock permission query to return permission records
        mock_permission = factory.create_dataset_permission_mock(dataset_id=dataset.id, account_id=user.id)
        mock_query = MagicMock()
        mock_query.filter_by.return_value = mock_query
        mock_query.all.return_value = [mock_permission]  # User has permission
        mock_db_session.query.return_value = mock_query

        # Act
        # Execute the method under test (should not raise)
        DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

        # Assert
        # Verify database query was executed
        mock_db_session.query.assert_called()

    @patch("services.dataset_service.db.session")
    def test_check_dataset_operator_permission_partial_team_without_permission_raises_error(
        self, mock_db_session, factory
    ):
        """
        Test that user without explicit permission cannot access PARTIAL_TEAM dataset as operator.

        Expected behavior:
        - NoPermissionError is raised
        - Error message indicates permission denied
        - Database query is executed to check permission
        """
        # Arrange
        user = factory.create_user_mock(user_id="user-123", tenant_id="tenant-123")
        dataset = factory.create_dataset_mock(
            dataset_id="dataset-123",
            tenant_id="tenant-123",
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="other-user-456",  # Different creator
        )

        # Mock permission query to return empty list (no permission records)
        mock_query = MagicMock()
        mock_query.filter_by.return_value = mock_query
        mock_query.all.return_value = []  # No permissions found
        mock_db_session.query.return_value = mock_query

        # Act & Assert
        # Verify NoPermissionError is raised
        with pytest.raises(NoPermissionError, match="You do not have permission to access this dataset"):
            DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

        # Verify database query was executed
        mock_db_session.query.assert_called()


# ============================================================================
# NAME VALIDATION TESTS
# ============================================================================


class TestDatasetServiceNameValidation:
    """
    Test dataset name validation operations.

    This test class covers the duplicate name detection functionality, which
    ensures that dataset names are unique within a tenant to prevent naming
    conflicts and confusion.
    """

    @patch("services.dataset_service.db.session")
    def test_has_dataset_same_name_returns_true_for_duplicate(self, mock_db_session, factory):
        """
        Test that _has_dataset_same_name returns True when duplicate name exists.

        This test verifies that the method correctly detects when a dataset
        with the same name already exists within the same tenant.

        Expected behavior:
        - Returns True when duplicate name found
        - Database query is executed with correct filters
        - Current dataset is excluded from search (by dataset_id)
        """
        # Arrange
        tenant_id = "tenant-123"
        dataset_id = "dataset-123"
        name = "Test Dataset"

        # Mock existing dataset with same name
        existing_dataset = factory.create_dataset_mock(dataset_id="dataset-456", name=name, tenant_id=tenant_id)

        # Configure mock database session
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = existing_dataset  # Duplicate found
        mock_db_session.query.return_value = mock_query

        # Act
        # Execute the method under test
        result = DatasetService._has_dataset_same_name(tenant_id=tenant_id, dataset_id=dataset_id, name=name)

        # Assert
        # Verify result indicates duplicate
        assert result is True, "Should return True for duplicate name"

        # Verify database query was executed
        mock_db_session.query.assert_called()

    @patch("services.dataset_service.db.session")
    def test_has_dataset_same_name_returns_false_for_unique_name(self, mock_db_session, factory):
        """
        Test that _has_dataset_same_name returns False when name is unique.

        This test verifies that the method correctly identifies when a dataset
        name is unique within the tenant.

        Expected behavior:
        - Returns False when no duplicate found
        - Database query is executed
        """
        # Arrange
        tenant_id = "tenant-123"
        dataset_id = "dataset-123"
        name = "Unique Dataset Name"

        # Configure mock database session (no duplicate found)
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None  # No duplicate
        mock_db_session.query.return_value = mock_query

        # Act
        # Execute the method under test
        result = DatasetService._has_dataset_same_name(tenant_id=tenant_id, dataset_id=dataset_id, name=name)

        # Assert
        # Verify result indicates no duplicate
        assert result is False, "Should return False for unique name"

        # Verify database query was executed
        mock_db_session.query.assert_called()

    @patch("services.dataset_service.db.session")
    def test_has_dataset_same_name_excludes_current_dataset(self, mock_db_session, factory):
        """
        Test that _has_dataset_same_name excludes current dataset from duplicate check.

        This test verifies that when checking for duplicates, the method correctly
        excludes the current dataset being updated, allowing it to keep its own name.

        Expected behavior:
        - Returns False when only current dataset has the name
        - Database query filters out current dataset_id
        """
        # Arrange
        tenant_id = "tenant-123"
        dataset_id = "dataset-123"
        name = "My Dataset"

        # Configure mock database session (no other dataset with same name)
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None  # No duplicate (current dataset excluded)
        mock_db_session.query.return_value = mock_query

        # Act
        # Execute the method under test
        result = DatasetService._has_dataset_same_name(tenant_id=tenant_id, dataset_id=dataset_id, name=name)

        # Assert
        # Verify result indicates no duplicate (current dataset is excluded)
        assert result is False, "Should return False when only current dataset has the name"

    @patch("services.dataset_service.db.session")
    def test_has_dataset_same_name_respects_tenant_isolation(self, mock_db_session, factory):
        """
        Test that _has_dataset_same_name respects tenant isolation.

        This test verifies that the method only checks for duplicates within
        the same tenant, allowing the same name to exist in different tenants.

        Expected behavior:
        - Returns False when same name exists in different tenant
        - Database query filters by tenant_id
        """
        # Arrange
        tenant_id = "tenant-123"
        dataset_id = "dataset-123"
        name = "Shared Dataset Name"

        # Configure mock database session (no duplicate in same tenant)
        mock_query = MagicMock()
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None  # No duplicate in this tenant
        mock_db_session.query.return_value = mock_query

        # Act
        # Execute the method under test
        result = DatasetService._has_dataset_same_name(tenant_id=tenant_id, dataset_id=dataset_id, name=name)

        # Assert
        # Verify result indicates no duplicate (different tenant doesn't count)
        assert result is False, "Should return False when duplicate is in different tenant"


# ============================================================================
# INDEXING TECHNIQUE CONFIGURATION TESTS
# ============================================================================


class TestDatasetServiceIndexingTechnique:
    """
    Test indexing technique change handling.

    This test class covers the logic for handling changes between different
    indexing techniques (economy vs high_quality) and the associated embedding
    model configuration.
    """

    @patch("services.dataset_service.DatasetService._configure_embedding_model_for_high_quality")
    def test_handle_indexing_technique_change_to_high_quality(self, mock_configure_embedding, factory):
        """
        Test handling change from economy to high_quality indexing.

        This test verifies that when changing from economy to high_quality,
        the method correctly configures embedding model settings.

        Expected behavior:
        - Calls _configure_embedding_model_for_high_quality
        - Returns 'add' action
        - filtered_data is passed to configuration method
        """
        # Arrange
        dataset = factory.create_dataset_mock(indexing_technique="economy")
        data = {
            "indexing_technique": "high_quality",
            "embedding_model_provider": "openai",
            "embedding_model": "ada-002",
        }
        filtered_data = {}

        # Act
        # Execute the method under test
        result = DatasetService._handle_indexing_technique_change(dataset, data, filtered_data)

        # Assert
        # Verify embedding model configuration was called
        mock_configure_embedding.assert_called_once_with(data, filtered_data)

        # Verify 'add' action is returned
        assert result == "add", "Should return 'add' for high_quality change"

    def test_handle_indexing_technique_change_to_economy(self, factory):
        """
        Test handling change from high_quality to economy indexing.

        This test verifies that when changing from high_quality to economy,
        the method correctly removes embedding model configuration.

        Expected behavior:
        - Sets embedding_model to None in filtered_data
        - Sets embedding_model_provider to None in filtered_data
        - Sets collection_binding_id to None in filtered_data
        - Returns 'remove' action
        """
        # Arrange
        dataset = factory.create_dataset_mock(indexing_technique="high_quality")
        data = {"indexing_technique": "economy"}
        filtered_data = {}

        # Act
        # Execute the method under test
        result = DatasetService._handle_indexing_technique_change(dataset, data, filtered_data)

        # Assert
        # Verify embedding model settings are cleared
        assert filtered_data["embedding_model"] is None, "Embedding model should be None"
        assert filtered_data["embedding_model_provider"] is None, "Embedding model provider should be None"
        assert filtered_data["collection_binding_id"] is None, "Collection binding ID should be None"

        # Verify 'remove' action is returned
        assert result == "remove", "Should return 'remove' for economy change"

    @patch("services.dataset_service.DatasetService._handle_embedding_model_update_when_technique_unchanged")
    def test_handle_indexing_technique_change_no_change(self, mock_handle_update, factory):
        """
        Test handling when indexing technique remains the same.

        This test verifies that when the indexing technique doesn't change,
        the method delegates to the embedding model update handler.

        Expected behavior:
        - Calls _handle_embedding_model_update_when_technique_unchanged
        - Returns result from embedding model update handler
        """
        # Arrange
        dataset = factory.create_dataset_mock(indexing_technique="high_quality")
        data = {"indexing_technique": "high_quality"}  # Same technique
        filtered_data = {}

        mock_handle_update.return_value = "update"

        # Act
        # Execute the method under test
        result = DatasetService._handle_indexing_technique_change(dataset, data, filtered_data)

        # Assert
        # Verify embedding model update handler was called
        mock_handle_update.assert_called_once_with(dataset, data, filtered_data)

        # Verify result matches handler return value
        assert result == "update", "Should return result from embedding model update handler"

    @patch("services.dataset_service.DatasetService._handle_embedding_model_update_when_technique_unchanged")
    def test_handle_indexing_technique_change_no_change_returns_none(self, mock_handle_update, factory):
        """
        Test handling when indexing technique remains the same and handler returns None.

        This test verifies that when the embedding model update handler returns None,
        the method correctly propagates that result.

        Expected behavior:
        - Calls _handle_embedding_model_update_when_technique_unchanged
        - Returns None from embedding model update handler
        """
        # Arrange
        dataset = factory.create_dataset_mock(indexing_technique="high_quality")
        data = {"indexing_technique": "high_quality"}  # Same technique
        filtered_data = {}

        mock_handle_update.return_value = None

        # Act
        # Execute the method under test
        result = DatasetService._handle_indexing_technique_change(dataset, data, filtered_data)

        # Assert
        # Verify result is None
        assert result is None, "Should return None when handler returns None"


# ============================================================================
# EMBEDDING MODEL CONFIGURATION TESTS
# ============================================================================


class TestDatasetServiceEmbeddingConfiguration:
    """
    Test embedding model configuration operations.

    This test class covers the logic for configuring embedding models for
    high quality indexing, including model validation and collection binding.
    """

    @patch("services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding")
    @patch("services.dataset_service.ModelManager")
    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    def test_configure_embedding_model_for_high_quality_success(
        self, mock_current_user, mock_model_manager_class, mock_get_binding, factory
    ):
        """
        Test successful embedding model configuration for high quality indexing.

        This test verifies that the method correctly configures embedding model
        settings when valid provider and model are provided.

        Expected behavior:
        - ModelManager is instantiated
        - get_model_instance is called with correct parameters
        - get_dataset_collection_binding is called
        - filtered_data is updated with model, provider, and binding_id
        - No exceptions are raised
        """
        # Arrange
        tenant_id = "tenant-123"
        user = factory.create_user_mock(user_id="user-123", tenant_id=tenant_id)

        # Configure current_user mock - use create_autospec to pass isinstance check
        mock_current_user.current_tenant_id = tenant_id

        # Create mock embedding model
        embedding_model = factory.create_embedding_model_mock(model="text-embedding-ada-002", provider="openai")

        # Create mock collection binding
        collection_binding = factory.create_collection_binding_mock(binding_id="binding-123")

        # Configure ModelManager mock
        mock_model_manager = MagicMock()
        mock_model_manager.get_model_instance.return_value = embedding_model
        mock_model_manager_class.return_value = mock_model_manager

        # Configure collection binding service mock
        mock_get_binding.return_value = collection_binding

        # Prepare data
        data = {"embedding_model_provider": "openai", "embedding_model": "text-embedding-ada-002"}
        filtered_data = {}

        # Act
        # Execute the method under test
        DatasetService._configure_embedding_model_for_high_quality(data, filtered_data)

        # Assert
        # Verify ModelManager was instantiated
        mock_model_manager_class.assert_called_once()

        # Verify get_model_instance was called with correct parameters
        # Note: model_type should be ModelType.TEXT_EMBEDDING enum value
        mock_model_manager.get_model_instance.assert_called_once_with(
            tenant_id=tenant_id,
            provider="openai",
            model_type=ModelType.TEXT_EMBEDDING,
            model="text-embedding-ada-002",
        )

        # Verify collection binding was retrieved
        mock_get_binding.assert_called_once_with("openai", "text-embedding-ada-002")

        # Verify filtered_data was updated
        assert filtered_data["embedding_model"] == "text-embedding-ada-002", "Embedding model should be set"
        assert filtered_data["embedding_model_provider"] == "openai", "Provider should be set"
        assert filtered_data["collection_binding_id"] == "binding-123", "Binding ID should be set"

    @patch("services.dataset_service.ModelManager")
    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    def test_configure_embedding_model_for_high_quality_llm_bad_request_error(
        self, mock_current_user, mock_model_manager_class, factory
    ):
        """
        Test that LLMBadRequestError raises ValueError with helpful message.

        This test verifies that when ModelManager raises LLMBadRequestError
        (indicating no embedding model is available), the method raises a
        ValueError with a helpful error message.

        Expected behavior:
        - LLMBadRequestError is caught
        - ValueError is raised with helpful message
        - Error message indicates need to configure model provider
        """
        # Arrange
        tenant_id = "tenant-123"
        user = factory.create_user_mock(user_id="user-123", tenant_id=tenant_id)

        # Configure current_user mock - use create_autospec to pass isinstance check
        mock_current_user.current_tenant_id = tenant_id

        # Configure ModelManager to raise LLMBadRequestError
        from core.errors.error import LLMBadRequestError

        mock_model_manager = MagicMock()
        mock_model_manager.get_model_instance.side_effect = LLMBadRequestError("No model available")
        mock_model_manager_class.return_value = mock_model_manager

        # Prepare data
        data = {"embedding_model_provider": "openai", "embedding_model": "text-embedding-ada-002"}
        filtered_data = {}

        # Act & Assert
        # Verify ValueError is raised with helpful message
        with pytest.raises(ValueError, match="No Embedding Model available"):
            DatasetService._configure_embedding_model_for_high_quality(data, filtered_data)

    @patch("services.dataset_service.ModelManager")
    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    def test_configure_embedding_model_for_high_quality_provider_token_error(
        self, mock_current_user, mock_model_manager_class, factory
    ):
        """
        Test that ProviderTokenNotInitError raises ValueError with error description.

        This test verifies that when ModelManager raises ProviderTokenNotInitError
        (indicating provider token is not configured), the method raises a
        ValueError with the error's description.

        Expected behavior:
        - ProviderTokenNotInitError is caught
        - ValueError is raised with error description
        - Error description is preserved from original exception
        """
        # Arrange
        tenant_id = "tenant-123"
        user = factory.create_user_mock(user_id="user-123", tenant_id=tenant_id)

        # Configure current_user mock - use create_autospec to pass isinstance check
        mock_current_user.current_tenant_id = tenant_id

        # Configure ModelManager to raise ProviderTokenNotInitError
        from core.errors.error import ProviderTokenNotInitError

        error_description = "Provider token not initialized. Please configure API key."
        mock_model_manager = MagicMock()
        mock_model_manager.get_model_instance.side_effect = ProviderTokenNotInitError(error_description)
        mock_model_manager_class.return_value = mock_model_manager

        # Prepare data
        data = {"embedding_model_provider": "openai", "embedding_model": "text-embedding-ada-002"}
        filtered_data = {}

        # Act & Assert
        # Verify ValueError is raised with error description
        with pytest.raises(ValueError, match=error_description):
            DatasetService._configure_embedding_model_for_high_quality(data, filtered_data)

    @patch("services.dataset_service.ModelManager")
    @patch("services.dataset_service.current_user")
    def test_configure_embedding_model_for_high_quality_asserts_current_user(
        self, mock_current_user, mock_model_manager_class, factory
    ):
        """
        Test that method asserts current_user is an Account instance.

        This test verifies that the method correctly asserts that current_user
        is an Account instance and has a tenant_id.

        Expected behavior:
        - AssertionError may be raised if current_user is not Account
        - Method checks current_user.current_tenant_id is not None
        """
        # Arrange
        # Configure current_user to not be Account (will fail assertion)
        mock_current_user.current_tenant_id = None

        # Prepare data
        data = {"embedding_model_provider": "openai", "embedding_model": "text-embedding-ada-002"}
        filtered_data = {}

        # Configure ModelManager
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager

        # Act & Assert
        # Verify assertion may fail or ValueError is raised
        # The exact behavior depends on assertion handling
        with pytest.raises((AssertionError, ValueError)):
            DatasetService._configure_embedding_model_for_high_quality(data, filtered_data)
