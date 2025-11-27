"""
Comprehensive unit tests for DatasetService update and delete operations.

This module contains extensive unit tests for the DatasetService class,
specifically focusing on update and delete operations for datasets.

The DatasetService provides methods for:
- Updating dataset configuration and settings (update_dataset)
- Deleting datasets with proper cleanup (delete_dataset)
- Updating RAG pipeline dataset settings (update_rag_pipeline_dataset_settings)
- Checking if dataset is in use (dataset_use_check)
- Updating dataset API access status (update_dataset_api_status)

These operations are critical for dataset lifecycle management and require
careful handling of permissions, dependencies, and data integrity.

This test suite ensures:
- Correct update of dataset properties
- Proper permission validation before updates/deletes
- Cascade deletion handling
- Event signaling for cleanup operations
- RAG pipeline dataset configuration updates
- API status management
- Use check validation

================================================================================
ARCHITECTURE OVERVIEW
================================================================================

The DatasetService update and delete operations are part of the dataset
lifecycle management system. These operations interact with multiple
components:

1. Permission System: All update/delete operations require proper
   permission validation to ensure users can only modify datasets they
   have access to.

2. Event System: Dataset deletion triggers the dataset_was_deleted event,
   which notifies other components to clean up related data (documents,
   segments, vector indices, etc.).

3. Dependency Checking: Before deletion, the system checks if the dataset
   is in use by any applications (via AppDatasetJoin).

4. RAG Pipeline Integration: RAG pipeline datasets have special update
   logic that handles chunk structure, indexing techniques, and embedding
   model configuration.

5. API Status Management: Datasets can have their API access enabled or
   disabled, which affects whether they can be accessed via the API.

================================================================================
TESTING STRATEGY
================================================================================

This test suite follows a comprehensive testing strategy that covers:

1. Update Operations:
   - Internal dataset updates
   - External dataset updates
   - RAG pipeline dataset updates
   - Permission validation
   - Name duplicate checking
   - Configuration validation

2. Delete Operations:
   - Successful deletion
   - Permission validation
   - Event signaling
   - Database cleanup
   - Not found handling

3. Use Check Operations:
   - Dataset in use detection
   - Dataset not in use detection
   - AppDatasetJoin query validation

4. API Status Operations:
   - Enable API access
   - Disable API access
   - Permission validation
   - Current user validation

5. RAG Pipeline Operations:
   - Unpublished dataset updates
   - Published dataset updates
   - Chunk structure validation
   - Indexing technique changes
   - Embedding model configuration

================================================================================
"""

import datetime
from unittest.mock import Mock, create_autospec, patch

import pytest
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from models import Account, TenantAccountRole
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetPermissionEnum,
)
from services.dataset_service import DatasetService
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


class DatasetUpdateDeleteTestDataFactory:
    """
    Factory class for creating test data and mock objects for dataset update/delete tests.

    This factory provides static methods to create mock objects for:
    - Dataset instances with various configurations
    - User/Account instances with different roles
    - Knowledge configuration objects
    - Database session mocks
    - Event signal mocks

    The factory methods help maintain consistency across tests and reduce
    code duplication when setting up test scenarios.
    """

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        provider: str = "vendor",
        name: str = "Test Dataset",
        description: str = "Test description",
        tenant_id: str = "tenant-123",
        indexing_technique: str = "high_quality",
        embedding_model_provider: str | None = "openai",
        embedding_model: str | None = "text-embedding-ada-002",
        collection_binding_id: str | None = "binding-123",
        enable_api: bool = True,
        permission: DatasetPermissionEnum = DatasetPermissionEnum.ONLY_ME,
        created_by: str = "user-123",
        chunk_structure: str | None = None,
        runtime_mode: str = "general",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Dataset with specified attributes.

        Args:
            dataset_id: Unique identifier for the dataset
            provider: Dataset provider (vendor, external)
            name: Dataset name
            description: Dataset description
            tenant_id: Tenant identifier
            indexing_technique: Indexing technique (high_quality, economy)
            embedding_model_provider: Embedding model provider
            embedding_model: Embedding model name
            collection_binding_id: Collection binding ID
            enable_api: Whether API access is enabled
            permission: Dataset permission level
            created_by: ID of user who created the dataset
            chunk_structure: Chunk structure for RAG pipeline datasets
            runtime_mode: Runtime mode (general, rag_pipeline)
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a Dataset instance
        """
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.provider = provider
        dataset.name = name
        dataset.description = description
        dataset.tenant_id = tenant_id
        dataset.indexing_technique = indexing_technique
        dataset.embedding_model_provider = embedding_model_provider
        dataset.embedding_model = embedding_model
        dataset.collection_binding_id = collection_binding_id
        dataset.enable_api = enable_api
        dataset.permission = permission
        dataset.created_by = created_by
        dataset.chunk_structure = chunk_structure
        dataset.runtime_mode = runtime_mode
        dataset.retrieval_model = {}
        dataset.keyword_number = 10
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_user_mock(
        user_id: str = "user-123",
        tenant_id: str = "tenant-123",
        role: TenantAccountRole = TenantAccountRole.NORMAL,
        is_dataset_editor: bool = True,
        **kwargs,
    ) -> Mock:
        """
        Create a mock user (Account) with specified attributes.

        Args:
            user_id: Unique identifier for the user
            tenant_id: Tenant identifier
            role: User role (OWNER, ADMIN, NORMAL, etc.)
            is_dataset_editor: Whether user has dataset editor permissions
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as an Account instance
        """
        user = create_autospec(Account, instance=True)
        user.id = user_id
        user.current_tenant_id = tenant_id
        user.current_role = role
        user.is_dataset_editor = is_dataset_editor
        for key, value in kwargs.items():
            setattr(user, key, value)
        return user

    @staticmethod
    def create_knowledge_configuration_mock(
        chunk_structure: str = "tree",
        indexing_technique: str = "high_quality",
        embedding_model_provider: str = "openai",
        embedding_model: str = "text-embedding-ada-002",
        keyword_number: int = 10,
        retrieval_model: dict | None = None,
        **kwargs,
    ) -> Mock:
        """
        Create a mock KnowledgeConfiguration entity.

        Args:
            chunk_structure: Chunk structure type
            indexing_technique: Indexing technique
            embedding_model_provider: Embedding model provider
            embedding_model: Embedding model name
            keyword_number: Keyword number for economy indexing
            retrieval_model: Retrieval model configuration
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a KnowledgeConfiguration instance
        """
        config = Mock()
        config.chunk_structure = chunk_structure
        config.indexing_technique = indexing_technique
        config.embedding_model_provider = embedding_model_provider
        config.embedding_model = embedding_model
        config.keyword_number = keyword_number
        config.retrieval_model = Mock()
        config.retrieval_model.model_dump.return_value = retrieval_model or {
            "search_method": "semantic_search",
            "top_k": 2,
        }
        for key, value in kwargs.items():
            setattr(config, key, value)
        return config

    @staticmethod
    def create_app_dataset_join_mock(
        app_id: str = "app-123",
        dataset_id: str = "dataset-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock AppDatasetJoin instance.

        Args:
            app_id: Application ID
            dataset_id: Dataset ID
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as an AppDatasetJoin instance
        """
        join = Mock(spec=AppDatasetJoin)
        join.app_id = app_id
        join.dataset_id = dataset_id
        for key, value in kwargs.items():
            setattr(join, key, value)
        return join


# ============================================================================
# Tests for update_dataset
# ============================================================================


class TestDatasetServiceUpdateDataset:
    """
    Comprehensive unit tests for DatasetService.update_dataset method.

    This test class covers the dataset update functionality, including
    internal and external dataset updates, permission validation, and
    name duplicate checking.

    The update_dataset method:
    1. Retrieves the dataset by ID
    2. Validates dataset exists
    3. Checks for duplicate names
    4. Validates user permissions
    5. Routes to appropriate update handler (internal or external)
    6. Returns the updated dataset

    Test scenarios include:
    - Successful internal dataset updates
    - Successful external dataset updates
    - Permission validation
    - Duplicate name detection
    - Dataset not found errors
    """

    @pytest.fixture
    def mock_dataset_service_dependencies(self):
        """
        Mock dataset service dependencies for testing.

        Provides mocked dependencies including:
        - get_dataset method
        - check_dataset_permission method
        - _has_dataset_same_name method
        - Database session
        - Current time utilities
        """
        with (
            patch("services.dataset_service.DatasetService.get_dataset") as mock_get_dataset,
            patch("services.dataset_service.DatasetService.check_dataset_permission") as mock_check_perm,
            patch("services.dataset_service.DatasetService._has_dataset_same_name") as mock_has_same_name,
            patch("extensions.ext_database.db.session") as mock_db,
            patch("services.dataset_service.naive_utc_now") as mock_naive_utc_now,
        ):
            current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
            mock_naive_utc_now.return_value = current_time

            yield {
                "get_dataset": mock_get_dataset,
                "check_permission": mock_check_perm,
                "has_same_name": mock_has_same_name,
                "db_session": mock_db,
                "naive_utc_now": mock_naive_utc_now,
                "current_time": current_time,
            }

    def test_update_dataset_internal_success(self, mock_dataset_service_dependencies):
        """
        Test successful update of an internal dataset.

        Verifies that when all validation passes, an internal dataset
        is updated correctly through the _update_internal_dataset method.

        This test ensures:
        - Dataset is retrieved correctly
        - Permission is checked
        - Name duplicate check is performed
        - Internal update handler is called
        - Updated dataset is returned
        """
        # Arrange
        dataset_id = "dataset-123"
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock(
            dataset_id=dataset_id, provider="vendor", name="Old Name"
        )
        user = DatasetUpdateDeleteTestDataFactory.create_user_mock()

        update_data = {
            "name": "New Name",
            "description": "New Description",
        }

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset
        mock_dataset_service_dependencies["has_same_name"].return_value = False

        with patch("services.dataset_service.DatasetService._update_internal_dataset") as mock_update_internal:
            mock_update_internal.return_value = dataset

            # Act
            result = DatasetService.update_dataset(dataset_id, update_data, user)

        # Assert
        assert result == dataset

        # Verify dataset was retrieved
        mock_dataset_service_dependencies["get_dataset"].assert_called_once_with(dataset_id)

        # Verify permission was checked
        mock_dataset_service_dependencies["check_permission"].assert_called_once_with(dataset, user)

        # Verify name duplicate check was performed
        mock_dataset_service_dependencies["has_same_name"].assert_called_once()

        # Verify internal update handler was called
        mock_update_internal.assert_called_once()

    def test_update_dataset_external_success(self, mock_dataset_service_dependencies):
        """
        Test successful update of an external dataset.

        Verifies that when all validation passes, an external dataset
        is updated correctly through the _update_external_dataset method.

        This test ensures:
        - Dataset is retrieved correctly
        - Permission is checked
        - Name duplicate check is performed
        - External update handler is called
        - Updated dataset is returned
        """
        # Arrange
        dataset_id = "dataset-123"
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock(
            dataset_id=dataset_id, provider="external", name="Old Name"
        )
        user = DatasetUpdateDeleteTestDataFactory.create_user_mock()

        update_data = {
            "name": "New Name",
            "external_knowledge_id": "new-knowledge-id",
        }

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset
        mock_dataset_service_dependencies["has_same_name"].return_value = False

        with patch("services.dataset_service.DatasetService._update_external_dataset") as mock_update_external:
            mock_update_external.return_value = dataset

            # Act
            result = DatasetService.update_dataset(dataset_id, update_data, user)

        # Assert
        assert result == dataset

        # Verify external update handler was called
        mock_update_external.assert_called_once()

    def test_update_dataset_not_found_error(self, mock_dataset_service_dependencies):
        """
        Test error handling when dataset is not found.

        Verifies that when the dataset ID doesn't exist, a ValueError
        is raised with an appropriate message.

        This test ensures:
        - Dataset not found error is handled correctly
        - No update operations are performed
        - Error message is clear
        """
        # Arrange
        dataset_id = "non-existent-dataset"
        user = DatasetUpdateDeleteTestDataFactory.create_user_mock()

        update_data = {"name": "New Name"}

        mock_dataset_service_dependencies["get_dataset"].return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match="Dataset not found"):
            DatasetService.update_dataset(dataset_id, update_data, user)

        # Verify no update operations were attempted
        mock_dataset_service_dependencies["check_permission"].assert_not_called()
        mock_dataset_service_dependencies["has_same_name"].assert_not_called()

    def test_update_dataset_duplicate_name_error(self, mock_dataset_service_dependencies):
        """
        Test error handling when dataset name already exists.

        Verifies that when a dataset with the same name already exists
        in the tenant, a ValueError is raised.

        This test ensures:
        - Duplicate name detection works correctly
        - Error message is clear
        - No update operations are performed
        """
        # Arrange
        dataset_id = "dataset-123"
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock(dataset_id=dataset_id)
        user = DatasetUpdateDeleteTestDataFactory.create_user_mock()

        update_data = {"name": "Existing Name"}

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset
        mock_dataset_service_dependencies["has_same_name"].return_value = True  # Duplicate exists

        # Act & Assert
        with pytest.raises(ValueError, match="Dataset name already exists"):
            DatasetService.update_dataset(dataset_id, update_data, user)

        # Verify permission check was not called (fails before that)
        mock_dataset_service_dependencies["check_permission"].assert_not_called()

    def test_update_dataset_permission_denied_error(self, mock_dataset_service_dependencies):
        """
        Test error handling when user lacks permission.

        Verifies that when the user doesn't have permission to update
        the dataset, a NoPermissionError is raised.

        This test ensures:
        - Permission validation works correctly
        - Error is raised before any updates
        - Error type is correct
        """
        # Arrange
        dataset_id = "dataset-123"
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock(dataset_id=dataset_id)
        user = DatasetUpdateDeleteTestDataFactory.create_user_mock()

        update_data = {"name": "New Name"}

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset
        mock_dataset_service_dependencies["has_same_name"].return_value = False
        mock_dataset_service_dependencies["check_permission"].side_effect = NoPermissionError("No permission")

        # Act & Assert
        with pytest.raises(NoPermissionError):
            DatasetService.update_dataset(dataset_id, update_data, user)


# ============================================================================
# Tests for delete_dataset
# ============================================================================


class TestDatasetServiceDeleteDataset:
    """
    Comprehensive unit tests for DatasetService.delete_dataset method.

    This test class covers the dataset deletion functionality, including
    permission validation, event signaling, and database cleanup.

    The delete_dataset method:
    1. Retrieves the dataset by ID
    2. Returns False if dataset not found
    3. Validates user permissions
    4. Sends dataset_was_deleted event
    5. Deletes dataset from database
    6. Commits transaction
    7. Returns True on success

    Test scenarios include:
    - Successful dataset deletion
    - Permission validation
    - Event signaling
    - Database cleanup
    - Not found handling
    """

    @pytest.fixture
    def mock_dataset_service_dependencies(self):
        """
        Mock dataset service dependencies for testing.

        Provides mocked dependencies including:
        - get_dataset method
        - check_dataset_permission method
        - dataset_was_deleted event signal
        - Database session
        """
        with (
            patch("services.dataset_service.DatasetService.get_dataset") as mock_get_dataset,
            patch("services.dataset_service.DatasetService.check_dataset_permission") as mock_check_perm,
            patch("services.dataset_service.dataset_was_deleted") as mock_event,
            patch("extensions.ext_database.db.session") as mock_db,
        ):
            yield {
                "get_dataset": mock_get_dataset,
                "check_permission": mock_check_perm,
                "dataset_was_deleted": mock_event,
                "db_session": mock_db,
            }

    def test_delete_dataset_success(self, mock_dataset_service_dependencies):
        """
        Test successful deletion of a dataset.

        Verifies that when all validation passes, a dataset is deleted
        correctly with proper event signaling and database cleanup.

        This test ensures:
        - Dataset is retrieved correctly
        - Permission is checked
        - Event is sent for cleanup
        - Dataset is deleted from database
        - Transaction is committed
        - Method returns True
        """
        # Arrange
        dataset_id = "dataset-123"
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock(dataset_id=dataset_id)
        user = DatasetUpdateDeleteTestDataFactory.create_user_mock()

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        # Act
        result = DatasetService.delete_dataset(dataset_id, user)

        # Assert
        assert result is True

        # Verify dataset was retrieved
        mock_dataset_service_dependencies["get_dataset"].assert_called_once_with(dataset_id)

        # Verify permission was checked
        mock_dataset_service_dependencies["check_permission"].assert_called_once_with(dataset, user)

        # Verify event was sent for cleanup
        mock_dataset_service_dependencies["dataset_was_deleted"].send.assert_called_once_with(dataset)

        # Verify dataset was deleted and committed
        mock_dataset_service_dependencies["db_session"].delete.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].commit.assert_called_once()

    def test_delete_dataset_not_found(self, mock_dataset_service_dependencies):
        """
        Test handling when dataset is not found.

        Verifies that when the dataset ID doesn't exist, the method
        returns False without performing any operations.

        This test ensures:
        - Method returns False when dataset not found
        - No permission checks are performed
        - No events are sent
        - No database operations are performed
        """
        # Arrange
        dataset_id = "non-existent-dataset"
        user = DatasetUpdateDeleteTestDataFactory.create_user_mock()

        mock_dataset_service_dependencies["get_dataset"].return_value = None

        # Act
        result = DatasetService.delete_dataset(dataset_id, user)

        # Assert
        assert result is False

        # Verify no operations were performed
        mock_dataset_service_dependencies["check_permission"].assert_not_called()
        mock_dataset_service_dependencies["dataset_was_deleted"].send.assert_not_called()
        mock_dataset_service_dependencies["db_session"].delete.assert_not_called()

    def test_delete_dataset_permission_denied_error(self, mock_dataset_service_dependencies):
        """
        Test error handling when user lacks permission.

        Verifies that when the user doesn't have permission to delete
        the dataset, a NoPermissionError is raised.

        This test ensures:
        - Permission validation works correctly
        - Error is raised before deletion
        - No database operations are performed
        """
        # Arrange
        dataset_id = "dataset-123"
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock(dataset_id=dataset_id)
        user = DatasetUpdateDeleteTestDataFactory.create_user_mock()

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset
        mock_dataset_service_dependencies["check_permission"].side_effect = NoPermissionError("No permission")

        # Act & Assert
        with pytest.raises(NoPermissionError):
            DatasetService.delete_dataset(dataset_id, user)

        # Verify no deletion was attempted
        mock_dataset_service_dependencies["db_session"].delete.assert_not_called()


# ============================================================================
# Tests for dataset_use_check
# ============================================================================


class TestDatasetServiceDatasetUseCheck:
    """
    Comprehensive unit tests for DatasetService.dataset_use_check method.

    This test class covers the dataset use checking functionality, which
    determines if a dataset is currently being used by any applications.

    The dataset_use_check method:
    1. Queries AppDatasetJoin table for the dataset ID
    2. Returns True if dataset is in use
    3. Returns False if dataset is not in use

    Test scenarios include:
    - Dataset in use (has AppDatasetJoin records)
    - Dataset not in use (no AppDatasetJoin records)
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

    def test_dataset_use_check_in_use(self, mock_db_session):
        """
        Test detection when dataset is in use.

        Verifies that when a dataset has associated AppDatasetJoin records,
        the method returns True.

        This test ensures:
        - Query is constructed correctly
        - True is returned when dataset is in use
        - Database query is executed
        """
        # Arrange
        dataset_id = "dataset-123"

        # Mock the exists() query to return True
        mock_execute = Mock()
        mock_execute.scalar_one.return_value = True
        mock_db_session.execute.return_value = mock_execute

        # Act
        result = DatasetService.dataset_use_check(dataset_id)

        # Assert
        assert result is True

        # Verify query was executed
        mock_db_session.execute.assert_called_once()

    def test_dataset_use_check_not_in_use(self, mock_db_session):
        """
        Test detection when dataset is not in use.

        Verifies that when a dataset has no associated AppDatasetJoin records,
        the method returns False.

        This test ensures:
        - Query is constructed correctly
        - False is returned when dataset is not in use
        - Database query is executed
        """
        # Arrange
        dataset_id = "dataset-123"

        # Mock the exists() query to return False
        mock_execute = Mock()
        mock_execute.scalar_one.return_value = False
        mock_db_session.execute.return_value = mock_execute

        # Act
        result = DatasetService.dataset_use_check(dataset_id)

        # Assert
        assert result is False

        # Verify query was executed
        mock_db_session.execute.assert_called_once()


# ============================================================================
# Tests for update_dataset_api_status
# ============================================================================


class TestDatasetServiceUpdateDatasetApiStatus:
    """
    Comprehensive unit tests for DatasetService.update_dataset_api_status method.

    This test class covers the dataset API status update functionality,
    which enables or disables API access for a dataset.

    The update_dataset_api_status method:
    1. Retrieves the dataset by ID
    2. Validates dataset exists
    3. Updates enable_api field
    4. Updates updated_by and updated_at fields
    5. Commits transaction

    Test scenarios include:
    - Successful API status enable
    - Successful API status disable
    - Dataset not found error
    - Current user validation
    """

    @pytest.fixture
    def mock_dataset_service_dependencies(self):
        """
        Mock dataset service dependencies for testing.

        Provides mocked dependencies including:
        - get_dataset method
        - current_user context
        - Database session
        - Current time utilities
        """
        with (
            patch("services.dataset_service.DatasetService.get_dataset") as mock_get_dataset,
            patch(
                "services.dataset_service.current_user", create_autospec(Account, instance=True)
            ) as mock_current_user,
            patch("extensions.ext_database.db.session") as mock_db,
            patch("services.dataset_service.naive_utc_now") as mock_naive_utc_now,
        ):
            current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
            mock_naive_utc_now.return_value = current_time
            mock_current_user.id = "user-123"

            yield {
                "get_dataset": mock_get_dataset,
                "current_user": mock_current_user,
                "db_session": mock_db,
                "naive_utc_now": mock_naive_utc_now,
                "current_time": current_time,
            }

    def test_update_dataset_api_status_enable_success(self, mock_dataset_service_dependencies):
        """
        Test successful enabling of dataset API access.

        Verifies that when all validation passes, the dataset's API
        access is enabled and the update is committed.

        This test ensures:
        - Dataset is retrieved correctly
        - enable_api is set to True
        - updated_by and updated_at are set
        - Transaction is committed
        """
        # Arrange
        dataset_id = "dataset-123"
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock(dataset_id=dataset_id, enable_api=False)

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        # Act
        DatasetService.update_dataset_api_status(dataset_id, True)

        # Assert
        assert dataset.enable_api is True
        assert dataset.updated_by == "user-123"
        assert dataset.updated_at == mock_dataset_service_dependencies["current_time"]

        # Verify dataset was retrieved
        mock_dataset_service_dependencies["get_dataset"].assert_called_once_with(dataset_id)

        # Verify transaction was committed
        mock_dataset_service_dependencies["db_session"].commit.assert_called_once()

    def test_update_dataset_api_status_disable_success(self, mock_dataset_service_dependencies):
        """
        Test successful disabling of dataset API access.

        Verifies that when all validation passes, the dataset's API
        access is disabled and the update is committed.

        This test ensures:
        - Dataset is retrieved correctly
        - enable_api is set to False
        - updated_by and updated_at are set
        - Transaction is committed
        """
        # Arrange
        dataset_id = "dataset-123"
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock(dataset_id=dataset_id, enable_api=True)

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        # Act
        DatasetService.update_dataset_api_status(dataset_id, False)

        # Assert
        assert dataset.enable_api is False
        assert dataset.updated_by == "user-123"

        # Verify transaction was committed
        mock_dataset_service_dependencies["db_session"].commit.assert_called_once()

    def test_update_dataset_api_status_not_found_error(self, mock_dataset_service_dependencies):
        """
        Test error handling when dataset is not found.

        Verifies that when the dataset ID doesn't exist, a NotFound
        exception is raised.

        This test ensures:
        - NotFound exception is raised
        - No updates are performed
        - Error message is appropriate
        """
        # Arrange
        dataset_id = "non-existent-dataset"

        mock_dataset_service_dependencies["get_dataset"].return_value = None

        # Act & Assert
        with pytest.raises(NotFound, match="Dataset not found"):
            DatasetService.update_dataset_api_status(dataset_id, True)

        # Verify no commit was attempted
        mock_dataset_service_dependencies["db_session"].commit.assert_not_called()

    def test_update_dataset_api_status_missing_current_user_error(self, mock_dataset_service_dependencies):
        """
        Test error handling when current_user is missing.

        Verifies that when current_user is None or has no ID, a ValueError
        is raised.

        This test ensures:
        - ValueError is raised when current_user is None
        - Error message is clear
        - No updates are committed
        """
        # Arrange
        dataset_id = "dataset-123"
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock(dataset_id=dataset_id)

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset
        mock_dataset_service_dependencies["current_user"].id = None  # Missing user ID

        # Act & Assert
        with pytest.raises(ValueError, match="Current user or current user id not found"):
            DatasetService.update_dataset_api_status(dataset_id, True)

        # Verify no commit was attempted
        mock_dataset_service_dependencies["db_session"].commit.assert_not_called()


# ============================================================================
# Tests for update_rag_pipeline_dataset_settings
# ============================================================================


class TestDatasetServiceUpdateRagPipelineDatasetSettings:
    """
    Comprehensive unit tests for DatasetService.update_rag_pipeline_dataset_settings method.

    This test class covers the RAG pipeline dataset settings update functionality,
    including chunk structure, indexing technique, and embedding model configuration.

    The update_rag_pipeline_dataset_settings method:
    1. Validates current_user and tenant
    2. Merges dataset into session
    3. Handles unpublished vs published datasets differently
    4. Updates chunk structure, indexing technique, and retrieval model
    5. Configures embedding model for high_quality indexing
    6. Updates keyword_number for economy indexing
    7. Commits transaction
    8. Triggers index update tasks if needed

    Test scenarios include:
    - Unpublished dataset updates
    - Published dataset updates
    - Chunk structure validation
    - Indexing technique changes
    - Embedding model configuration
    - Error handling
    """

    @pytest.fixture
    def mock_session(self):
        """
        Mock database session for testing.

        Provides a mocked SQLAlchemy session for testing session operations.
        """
        return Mock(spec=Session)

    @pytest.fixture
    def mock_dataset_service_dependencies(self):
        """
        Mock dataset service dependencies for testing.

        Provides mocked dependencies including:
        - current_user context
        - ModelManager
        - DatasetCollectionBindingService
        - Database session operations
        - Task scheduling
        """
        with (
            patch(
                "services.dataset_service.current_user", create_autospec(Account, instance=True)
            ) as mock_current_user,
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding"
            ) as mock_get_binding,
            patch("services.dataset_service.deal_dataset_index_update_task") as mock_task,
        ):
            mock_current_user.current_tenant_id = "tenant-123"
            mock_current_user.id = "user-123"

            yield {
                "current_user": mock_current_user,
                "model_manager": mock_model_manager,
                "get_binding": mock_get_binding,
                "task": mock_task,
            }

    def test_update_rag_pipeline_dataset_settings_unpublished_success(
        self, mock_session, mock_dataset_service_dependencies
    ):
        """
        Test successful update of unpublished RAG pipeline dataset.

        Verifies that when a dataset is not published, all settings can
        be updated including chunk structure and indexing technique.

        This test ensures:
        - Current user validation passes
        - Dataset is merged into session
        - Chunk structure is updated
        - Indexing technique is updated
        - Embedding model is configured for high_quality
        - Retrieval model is updated
        - Dataset is added to session
        """
        # Arrange
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock(
            dataset_id="dataset-123",
            runtime_mode="rag_pipeline",
            chunk_structure="tree",
            indexing_technique="high_quality",
        )

        knowledge_config = DatasetUpdateDeleteTestDataFactory.create_knowledge_configuration_mock(
            chunk_structure="list",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
        )

        # Mock embedding model
        mock_embedding_model = Mock()
        mock_embedding_model.model = "text-embedding-ada-002"
        mock_embedding_model.provider = "openai"

        mock_model_instance = Mock()
        mock_model_instance.get_model_instance.return_value = mock_embedding_model
        mock_dataset_service_dependencies["model_manager"].return_value = mock_model_instance

        # Mock collection binding
        mock_binding = Mock()
        mock_binding.id = "binding-123"
        mock_dataset_service_dependencies["get_binding"].return_value = mock_binding

        mock_session.merge.return_value = dataset

        # Act
        DatasetService.update_rag_pipeline_dataset_settings(
            mock_session, dataset, knowledge_config, has_published=False
        )

        # Assert
        assert dataset.chunk_structure == "list"
        assert dataset.indexing_technique == "high_quality"
        assert dataset.embedding_model == "text-embedding-ada-002"
        assert dataset.embedding_model_provider == "openai"
        assert dataset.collection_binding_id == "binding-123"

        # Verify dataset was added to session
        mock_session.add.assert_called_once_with(dataset)

    def test_update_rag_pipeline_dataset_settings_published_chunk_structure_error(
        self, mock_session, mock_dataset_service_dependencies
    ):
        """
        Test error handling when trying to update chunk structure of published dataset.

        Verifies that when a dataset is published and has an existing chunk structure,
        attempting to change it raises a ValueError.

        This test ensures:
        - Chunk structure change is detected
        - ValueError is raised with appropriate message
        - No updates are committed
        """
        # Arrange
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock(
            dataset_id="dataset-123",
            runtime_mode="rag_pipeline",
            chunk_structure="tree",  # Existing structure
            indexing_technique="high_quality",
        )

        knowledge_config = DatasetUpdateDeleteTestDataFactory.create_knowledge_configuration_mock(
            chunk_structure="list",  # Different structure
            indexing_technique="high_quality",
        )

        mock_session.merge.return_value = dataset

        # Act & Assert
        with pytest.raises(ValueError, match="Chunk structure is not allowed to be updated"):
            DatasetService.update_rag_pipeline_dataset_settings(
                mock_session, dataset, knowledge_config, has_published=True
            )

        # Verify no commit was attempted
        mock_session.commit.assert_not_called()

    def test_update_rag_pipeline_dataset_settings_published_economy_error(
        self, mock_session, mock_dataset_service_dependencies
    ):
        """
        Test error handling when trying to change to economy indexing on published dataset.

        Verifies that when a dataset is published, changing indexing technique to
        economy is not allowed and raises a ValueError.

        This test ensures:
        - Economy indexing change is detected
        - ValueError is raised with appropriate message
        - No updates are committed
        """
        # Arrange
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock(
            dataset_id="dataset-123",
            runtime_mode="rag_pipeline",
            indexing_technique="high_quality",  # Current technique
        )

        knowledge_config = DatasetUpdateDeleteTestDataFactory.create_knowledge_configuration_mock(
            indexing_technique="economy",  # Trying to change to economy
        )

        mock_session.merge.return_value = dataset

        # Act & Assert
        with pytest.raises(
            ValueError, match="Knowledge base indexing technique is not allowed to be updated to economy"
        ):
            DatasetService.update_rag_pipeline_dataset_settings(
                mock_session, dataset, knowledge_config, has_published=True
            )

    def test_update_rag_pipeline_dataset_settings_missing_current_user_error(
        self, mock_session, mock_dataset_service_dependencies
    ):
        """
        Test error handling when current_user is missing.

        Verifies that when current_user is None or has no tenant ID, a ValueError
        is raised.

        This test ensures:
        - Current user validation works correctly
        - Error message is clear
        - No updates are performed
        """
        # Arrange
        dataset = DatasetUpdateDeleteTestDataFactory.create_dataset_mock()
        knowledge_config = DatasetUpdateDeleteTestDataFactory.create_knowledge_configuration_mock()

        mock_dataset_service_dependencies["current_user"].current_tenant_id = None  # Missing tenant

        # Act & Assert
        with pytest.raises(ValueError, match="Current user or current tenant not found"):
            DatasetService.update_rag_pipeline_dataset_settings(
                mock_session, dataset, knowledge_config, has_published=False
            )


# ============================================================================
# Additional Documentation and Notes
# ============================================================================
#
# This test suite covers the core update and delete operations for datasets.
# Additional test scenarios that could be added:
#
# 1. Update Operations:
#    - Testing with different indexing techniques
#    - Testing embedding model provider changes
#    - Testing retrieval model updates
#    - Testing icon_info updates
#    - Testing partial_member_list updates
#
# 2. Delete Operations:
#    - Testing cascade deletion of related data
#    - Testing event handler execution
#    - Testing with datasets that have documents
#    - Testing with datasets that have segments
#
# 3. RAG Pipeline Operations:
#    - Testing economy indexing technique updates
#    - Testing embedding model provider errors
#    - Testing keyword_number updates
#    - Testing index update task triggering
#
# 4. Integration Scenarios:
#    - Testing update followed by delete
#    - Testing multiple updates in sequence
#    - Testing concurrent update attempts
#    - Testing with different user roles
#
# These scenarios are not currently implemented but could be added if needed
# based on real-world usage patterns or discovered edge cases.
#
# ============================================================================
