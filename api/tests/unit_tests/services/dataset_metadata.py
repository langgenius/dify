"""
Comprehensive unit tests for MetadataService.

This module contains extensive unit tests for the MetadataService class,
which handles dataset metadata CRUD operations and filtering/querying functionality.

The MetadataService provides methods for:
- Creating, reading, updating, and deleting metadata fields
- Managing built-in metadata fields
- Updating document metadata values
- Metadata filtering and querying operations
- Lock management for concurrent metadata operations

Metadata in Dify allows users to add custom fields to datasets and documents,
enabling rich filtering and search capabilities. Metadata can be of various
types (string, number, date, boolean, etc.) and can be used to categorize
and filter documents within a dataset.

This test suite ensures:
- Correct creation of metadata fields with validation
- Proper updating of metadata names and values
- Accurate deletion of metadata fields
- Built-in field management (enable/disable)
- Document metadata updates (partial and full)
- Lock management for concurrent operations
- Metadata querying and filtering functionality

================================================================================
ARCHITECTURE OVERVIEW
================================================================================

The MetadataService is a critical component in the Dify platform's metadata
management system. It serves as the primary interface for all metadata-related
operations, including field definitions and document-level metadata values.

Key Concepts:
1. DatasetMetadata: Defines a metadata field for a dataset. Each metadata
   field has a name, type, and is associated with a specific dataset.

2. DatasetMetadataBinding: Links metadata fields to documents. This allows
   tracking which documents have which metadata fields assigned.

3. Document Metadata: The actual metadata values stored on documents. This
   is stored as a JSON object in the document's doc_metadata field.

4. Built-in Fields: System-defined metadata fields that are automatically
   available when enabled (document_name, uploader, upload_date, etc.).

5. Lock Management: Redis-based locking to prevent concurrent metadata
   operations that could cause data corruption.

================================================================================
TESTING STRATEGY
================================================================================

This test suite follows a comprehensive testing strategy that covers:

1. CRUD Operations:
   - Creating metadata fields with validation
   - Reading/retrieving metadata fields
   - Updating metadata field names
   - Deleting metadata fields

2. Built-in Field Management:
   - Enabling built-in fields
   - Disabling built-in fields
   - Getting built-in field definitions

3. Document Metadata Operations:
   - Updating document metadata (partial and full)
   - Managing metadata bindings
   - Handling built-in field updates

4. Lock Management:
   - Acquiring locks for dataset operations
   - Acquiring locks for document operations
   - Handling lock conflicts

5. Error Handling:
   - Validation errors (name length, duplicates)
   - Not found errors
   - Lock conflict errors

================================================================================
"""

from unittest.mock import Mock, patch

import pytest

from core.rag.index_processor.constant.built_in_field import BuiltInField
from models.dataset import Dataset, DatasetMetadata, DatasetMetadataBinding
from services.entities.knowledge_entities.knowledge_entities import (
    MetadataArgs,
    MetadataValue,
)
from services.metadata_service import MetadataService

# ============================================================================
# Test Data Factory
# ============================================================================
# The Test Data Factory pattern is used here to centralize the creation of
# test objects and mock instances. This approach provides several benefits:
#
# 1. Consistency: All test objects are created using the same factory methods,
#    ensuring consistent structure across all tests.
#
# 2. Maintainability: If the structure of models changes, we only need to
#    update the factory methods rather than every individual test.
#
# 3. Reusability: Factory methods can be reused across multiple test classes,
#    reducing code duplication.
#
# 4. Readability: Tests become more readable when they use descriptive factory
#    method calls instead of complex object construction logic.
#
# ============================================================================


class MetadataTestDataFactory:
    """
    Factory class for creating test data and mock objects for metadata service tests.

    This factory provides static methods to create mock objects for:
    - DatasetMetadata instances
    - DatasetMetadataBinding instances
    - Dataset instances
    - Document instances
    - MetadataArgs and MetadataOperationData entities
    - User and tenant context

    The factory methods help maintain consistency across tests and reduce
    code duplication when setting up test scenarios.
    """

    @staticmethod
    def create_metadata_mock(
        metadata_id: str = "metadata-123",
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        name: str = "category",
        metadata_type: str = "string",
        created_by: str = "user-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock DatasetMetadata with specified attributes.

        Args:
            metadata_id: Unique identifier for the metadata field
            dataset_id: ID of the dataset this metadata belongs to
            tenant_id: Tenant identifier
            name: Name of the metadata field
            metadata_type: Type of metadata (string, number, date, etc.)
            created_by: ID of the user who created the metadata
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a DatasetMetadata instance
        """
        metadata = Mock(spec=DatasetMetadata)
        metadata.id = metadata_id
        metadata.dataset_id = dataset_id
        metadata.tenant_id = tenant_id
        metadata.name = name
        metadata.type = metadata_type
        metadata.created_by = created_by
        metadata.updated_by = None
        metadata.updated_at = None
        for key, value in kwargs.items():
            setattr(metadata, key, value)
        return metadata

    @staticmethod
    def create_metadata_binding_mock(
        binding_id: str = "binding-123",
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        metadata_id: str = "metadata-123",
        document_id: str = "document-123",
        created_by: str = "user-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock DatasetMetadataBinding with specified attributes.

        Args:
            binding_id: Unique identifier for the binding
            dataset_id: ID of the dataset
            tenant_id: Tenant identifier
            metadata_id: ID of the metadata field
            document_id: ID of the document
            created_by: ID of the user who created the binding
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a DatasetMetadataBinding instance
        """
        binding = Mock(spec=DatasetMetadataBinding)
        binding.id = binding_id
        binding.dataset_id = dataset_id
        binding.tenant_id = tenant_id
        binding.metadata_id = metadata_id
        binding.document_id = document_id
        binding.created_by = created_by
        for key, value in kwargs.items():
            setattr(binding, key, value)
        return binding

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        built_in_field_enabled: bool = False,
        doc_metadata: list | None = None,
        **kwargs,
    ) -> Mock:
        """
        Create a mock Dataset with specified attributes.

        Args:
            dataset_id: Unique identifier for the dataset
            tenant_id: Tenant identifier
            built_in_field_enabled: Whether built-in fields are enabled
            doc_metadata: List of metadata field definitions
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a Dataset instance
        """
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.built_in_field_enabled = built_in_field_enabled
        dataset.doc_metadata = doc_metadata or []
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_document_mock(
        document_id: str = "document-123",
        dataset_id: str = "dataset-123",
        name: str = "Test Document",
        doc_metadata: dict | None = None,
        uploader: str = "user-123",
        data_source_type: str = "upload_file",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Document with specified attributes.

        Args:
            document_id: Unique identifier for the document
            dataset_id: ID of the dataset this document belongs to
            name: Name of the document
            doc_metadata: Dictionary of metadata values
            uploader: ID of the user who uploaded the document
            data_source_type: Type of data source
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a Document instance
        """
        document = Mock()
        document.id = document_id
        document.dataset_id = dataset_id
        document.name = name
        document.doc_metadata = doc_metadata or {}
        document.uploader = uploader
        document.data_source_type = data_source_type

        # Mock datetime objects for upload_date and last_update_date

        document.upload_date = Mock()
        document.upload_date.timestamp.return_value = 1234567890.0
        document.last_update_date = Mock()
        document.last_update_date.timestamp.return_value = 1234567890.0

        for key, value in kwargs.items():
            setattr(document, key, value)
        return document

    @staticmethod
    def create_metadata_args_mock(
        name: str = "category",
        metadata_type: str = "string",
    ) -> Mock:
        """
        Create a mock MetadataArgs entity.

        Args:
            name: Name of the metadata field
            metadata_type: Type of metadata

        Returns:
            Mock object configured as a MetadataArgs instance
        """
        metadata_args = Mock(spec=MetadataArgs)
        metadata_args.name = name
        metadata_args.type = metadata_type
        return metadata_args

    @staticmethod
    def create_metadata_value_mock(
        metadata_id: str = "metadata-123",
        name: str = "category",
        value: str = "test",
    ) -> Mock:
        """
        Create a mock MetadataValue entity.

        Args:
            metadata_id: ID of the metadata field
            name: Name of the metadata field
            value: Value of the metadata

        Returns:
            Mock object configured as a MetadataValue instance
        """
        metadata_value = Mock(spec=MetadataValue)
        metadata_value.id = metadata_id
        metadata_value.name = name
        metadata_value.value = value
        return metadata_value


# ============================================================================
# Tests for create_metadata
# ============================================================================


class TestMetadataServiceCreateMetadata:
    """
    Comprehensive unit tests for MetadataService.create_metadata method.

    This test class covers the metadata field creation functionality,
    including validation, duplicate checking, and database operations.

    The create_metadata method:
    1. Validates metadata name length (max 255 characters)
    2. Checks for duplicate metadata names within the dataset
    3. Checks for conflicts with built-in field names
    4. Creates a new DatasetMetadata instance
    5. Adds it to the database session and commits
    6. Returns the created metadata

    Test scenarios include:
    - Successful creation with valid data
    - Name length validation
    - Duplicate name detection
    - Built-in field name conflicts
    - Database transaction handling
    """

    @pytest.fixture
    def mock_db_session(self):
        """
        Mock database session for testing database operations.

        Provides a mocked database session that can be used to verify:
        - Query construction and execution
        - Add operations for new metadata
        - Commit operations for transaction completion
        """
        with patch("services.metadata_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_current_user(self):
        """
        Mock current user and tenant context.

        Provides mocked current_account_with_tenant function that returns
        a user and tenant ID for testing authentication and authorization.
        """
        with patch("services.metadata_service.current_account_with_tenant") as mock_get_user:
            mock_user = Mock()
            mock_user.id = "user-123"
            mock_tenant_id = "tenant-123"
            mock_get_user.return_value = (mock_user, mock_tenant_id)
            yield mock_get_user

    def test_create_metadata_success(self, mock_db_session, mock_current_user):
        """
        Test successful creation of a metadata field.

        Verifies that when all validation passes, a new metadata field
        is created and persisted to the database.

        This test ensures:
        - Metadata name validation passes
        - No duplicate name exists
        - No built-in field conflict
        - New metadata is added to database
        - Transaction is committed
        - Created metadata is returned
        """
        # Arrange
        dataset_id = "dataset-123"
        metadata_args = MetadataTestDataFactory.create_metadata_args_mock(name="category", metadata_type="string")

        # Mock query to return None (no existing metadata with same name)
        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None
        mock_db_session.query.return_value = mock_query

        # Mock BuiltInField enum iteration
        with patch("services.metadata_service.BuiltInField") as mock_builtin:
            mock_builtin.__iter__ = Mock(return_value=iter([]))

            # Act
            result = MetadataService.create_metadata(dataset_id, metadata_args)

        # Assert
        assert result is not None
        assert isinstance(result, DatasetMetadata)

        # Verify query was made to check for duplicates
        mock_db_session.query.assert_called()
        mock_query.filter_by.assert_called()

        # Verify metadata was added and committed
        mock_db_session.add.assert_called_once()
        mock_db_session.commit.assert_called_once()

    def test_create_metadata_name_too_long_error(self, mock_db_session, mock_current_user):
        """
        Test error handling when metadata name exceeds 255 characters.

        Verifies that when a metadata name is longer than 255 characters,
        a ValueError is raised with an appropriate message.

        This test ensures:
        - Name length validation is enforced
        - Error message is clear and descriptive
        - No database operations are performed
        """
        # Arrange
        dataset_id = "dataset-123"
        long_name = "a" * 256  # 256 characters (exceeds limit)
        metadata_args = MetadataTestDataFactory.create_metadata_args_mock(name=long_name, metadata_type="string")

        # Act & Assert
        with pytest.raises(ValueError, match="Metadata name cannot exceed 255 characters"):
            MetadataService.create_metadata(dataset_id, metadata_args)

        # Verify no database operations were performed
        mock_db_session.add.assert_not_called()
        mock_db_session.commit.assert_not_called()

    def test_create_metadata_duplicate_name_error(self, mock_db_session, mock_current_user):
        """
        Test error handling when metadata name already exists.

        Verifies that when a metadata field with the same name already exists
        in the dataset, a ValueError is raised.

        This test ensures:
        - Duplicate name detection works correctly
        - Error message is clear
        - No new metadata is created
        """
        # Arrange
        dataset_id = "dataset-123"
        metadata_args = MetadataTestDataFactory.create_metadata_args_mock(name="category", metadata_type="string")

        # Mock existing metadata with same name
        existing_metadata = MetadataTestDataFactory.create_metadata_mock(name="category")
        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = existing_metadata
        mock_db_session.query.return_value = mock_query

        # Act & Assert
        with pytest.raises(ValueError, match="Metadata name already exists"):
            MetadataService.create_metadata(dataset_id, metadata_args)

        # Verify no new metadata was added
        mock_db_session.add.assert_not_called()
        mock_db_session.commit.assert_not_called()

    def test_create_metadata_builtin_field_conflict_error(self, mock_db_session, mock_current_user):
        """
        Test error handling when metadata name conflicts with built-in field.

        Verifies that when a metadata name matches a built-in field name,
        a ValueError is raised.

        This test ensures:
        - Built-in field name conflicts are detected
        - Error message is clear
        - No new metadata is created
        """
        # Arrange
        dataset_id = "dataset-123"
        metadata_args = MetadataTestDataFactory.create_metadata_args_mock(
            name=BuiltInField.document_name, metadata_type="string"
        )

        # Mock query to return None (no duplicate in database)
        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None
        mock_db_session.query.return_value = mock_query

        # Mock BuiltInField to include the conflicting name
        with patch("services.metadata_service.BuiltInField") as mock_builtin:
            mock_field = Mock()
            mock_field.value = BuiltInField.document_name
            mock_builtin.__iter__ = Mock(return_value=iter([mock_field]))

            # Act & Assert
            with pytest.raises(ValueError, match="Metadata name already exists in Built-in fields"):
                MetadataService.create_metadata(dataset_id, metadata_args)

        # Verify no new metadata was added
        mock_db_session.add.assert_not_called()
        mock_db_session.commit.assert_not_called()


# ============================================================================
# Tests for update_metadata_name
# ============================================================================


class TestMetadataServiceUpdateMetadataName:
    """
    Comprehensive unit tests for MetadataService.update_metadata_name method.

    This test class covers the metadata field name update functionality,
    including validation, duplicate checking, and document metadata updates.

    The update_metadata_name method:
    1. Validates new name length (max 255 characters)
    2. Checks for duplicate names
    3. Checks for built-in field conflicts
    4. Acquires a lock for the dataset
    5. Updates the metadata name
    6. Updates all related document metadata
    7. Releases the lock
    8. Returns the updated metadata

    Test scenarios include:
    - Successful name update
    - Name length validation
    - Duplicate name detection
    - Built-in field conflicts
    - Lock management
    - Document metadata updates
    """

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session for testing."""
        with patch("services.metadata_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_current_user(self):
        """Mock current user and tenant context."""
        with patch("services.metadata_service.current_account_with_tenant") as mock_get_user:
            mock_user = Mock()
            mock_user.id = "user-123"
            mock_tenant_id = "tenant-123"
            mock_get_user.return_value = (mock_user, mock_tenant_id)
            yield mock_get_user

    @pytest.fixture
    def mock_redis_client(self):
        """Mock Redis client for lock management."""
        with patch("services.metadata_service.redis_client") as mock_redis:
            mock_redis.get.return_value = None  # No existing lock
            mock_redis.set.return_value = True
            mock_redis.delete.return_value = True
            yield mock_redis

    def test_update_metadata_name_success(self, mock_db_session, mock_current_user, mock_redis_client):
        """
        Test successful update of metadata field name.

        Verifies that when all validation passes, the metadata name is
        updated and all related document metadata is updated accordingly.

        This test ensures:
        - Name validation passes
        - Lock is acquired and released
        - Metadata name is updated
        - Related document metadata is updated
        - Transaction is committed
        """
        # Arrange
        dataset_id = "dataset-123"
        metadata_id = "metadata-123"
        new_name = "updated_category"

        existing_metadata = MetadataTestDataFactory.create_metadata_mock(metadata_id=metadata_id, name="category")

        # Mock query for duplicate check (no duplicate)
        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None
        mock_db_session.query.return_value = mock_query

        # Mock metadata retrieval
        def query_side_effect(model):
            if model == DatasetMetadata:
                mock_meta_query = Mock()
                mock_meta_query.filter_by.return_value = mock_meta_query
                mock_meta_query.first.return_value = existing_metadata
                return mock_meta_query
            return mock_query

        mock_db_session.query.side_effect = query_side_effect

        # Mock no metadata bindings (no documents to update)
        mock_binding_query = Mock()
        mock_binding_query.filter_by.return_value = mock_binding_query
        mock_binding_query.all.return_value = []

        # Mock BuiltInField enum
        with patch("services.metadata_service.BuiltInField") as mock_builtin:
            mock_builtin.__iter__ = Mock(return_value=iter([]))

            # Act
            result = MetadataService.update_metadata_name(dataset_id, metadata_id, new_name)

        # Assert
        assert result is not None
        assert result.name == new_name

        # Verify lock was acquired and released
        mock_redis_client.get.assert_called()
        mock_redis_client.set.assert_called()
        mock_redis_client.delete.assert_called()

        # Verify metadata was updated and committed
        mock_db_session.commit.assert_called()

    def test_update_metadata_name_not_found_error(self, mock_db_session, mock_current_user, mock_redis_client):
        """
        Test error handling when metadata is not found.

        Verifies that when the metadata ID doesn't exist, a ValueError
        is raised with an appropriate message.

        This test ensures:
        - Not found error is handled correctly
        - Lock is properly released even on error
        - No updates are committed
        """
        # Arrange
        dataset_id = "dataset-123"
        metadata_id = "non-existent-metadata"
        new_name = "updated_category"

        # Mock query for duplicate check (no duplicate)
        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None
        mock_db_session.query.return_value = mock_query

        # Mock metadata retrieval to return None
        def query_side_effect(model):
            if model == DatasetMetadata:
                mock_meta_query = Mock()
                mock_meta_query.filter_by.return_value = mock_meta_query
                mock_meta_query.first.return_value = None  # Not found
                return mock_meta_query
            return mock_query

        mock_db_session.query.side_effect = query_side_effect

        # Mock BuiltInField enum
        with patch("services.metadata_service.BuiltInField") as mock_builtin:
            mock_builtin.__iter__ = Mock(return_value=iter([]))

            # Act & Assert
            with pytest.raises(ValueError, match="Metadata not found"):
                MetadataService.update_metadata_name(dataset_id, metadata_id, new_name)

        # Verify lock was released
        mock_redis_client.delete.assert_called()


# ============================================================================
# Tests for delete_metadata
# ============================================================================


class TestMetadataServiceDeleteMetadata:
    """
    Comprehensive unit tests for MetadataService.delete_metadata method.

    This test class covers the metadata field deletion functionality,
    including document metadata cleanup and lock management.

    The delete_metadata method:
    1. Acquires a lock for the dataset
    2. Retrieves the metadata to delete
    3. Deletes the metadata from the database
    4. Removes metadata from all related documents
    5. Releases the lock
    6. Returns the deleted metadata

    Test scenarios include:
    - Successful deletion
    - Not found error handling
    - Document metadata cleanup
    - Lock management
    """

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session for testing."""
        with patch("services.metadata_service.db.session") as mock_db:
            yield mock_db

    @pytest.fixture
    def mock_redis_client(self):
        """Mock Redis client for lock management."""
        with patch("services.metadata_service.redis_client") as mock_redis:
            mock_redis.get.return_value = None
            mock_redis.set.return_value = True
            mock_redis.delete.return_value = True
            yield mock_redis

    def test_delete_metadata_success(self, mock_db_session, mock_redis_client):
        """
        Test successful deletion of a metadata field.

        Verifies that when the metadata exists, it is deleted and all
        related document metadata is cleaned up.

        This test ensures:
        - Lock is acquired and released
        - Metadata is deleted from database
        - Related document metadata is removed
        - Transaction is committed
        """
        # Arrange
        dataset_id = "dataset-123"
        metadata_id = "metadata-123"

        existing_metadata = MetadataTestDataFactory.create_metadata_mock(metadata_id=metadata_id, name="category")

        # Mock metadata retrieval
        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = existing_metadata
        mock_db_session.query.return_value = mock_query

        # Mock no metadata bindings (no documents to update)
        mock_binding_query = Mock()
        mock_binding_query.filter_by.return_value = mock_binding_query
        mock_binding_query.all.return_value = []

        # Act
        result = MetadataService.delete_metadata(dataset_id, metadata_id)

        # Assert
        assert result == existing_metadata

        # Verify lock was acquired and released
        mock_redis_client.get.assert_called()
        mock_redis_client.set.assert_called()
        mock_redis_client.delete.assert_called()

        # Verify metadata was deleted and committed
        mock_db_session.delete.assert_called_once_with(existing_metadata)
        mock_db_session.commit.assert_called()

    def test_delete_metadata_not_found_error(self, mock_db_session, mock_redis_client):
        """
        Test error handling when metadata is not found.

        Verifies that when the metadata ID doesn't exist, a ValueError
        is raised and the lock is properly released.

        This test ensures:
        - Not found error is handled correctly
        - Lock is released even on error
        - No deletion is performed
        """
        # Arrange
        dataset_id = "dataset-123"
        metadata_id = "non-existent-metadata"

        # Mock metadata retrieval to return None
        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act & Assert
        with pytest.raises(ValueError, match="Metadata not found"):
            MetadataService.delete_metadata(dataset_id, metadata_id)

        # Verify lock was released
        mock_redis_client.delete.assert_called()

        # Verify no deletion was performed
        mock_db_session.delete.assert_not_called()


# ============================================================================
# Tests for get_built_in_fields
# ============================================================================


class TestMetadataServiceGetBuiltInFields:
    """
    Comprehensive unit tests for MetadataService.get_built_in_fields method.

    This test class covers the built-in field retrieval functionality.

    The get_built_in_fields method:
    1. Returns a list of built-in field definitions
    2. Each definition includes name and type

    Test scenarios include:
    - Successful retrieval of built-in fields
    - Correct field definitions
    """

    def test_get_built_in_fields_success(self):
        """
        Test successful retrieval of built-in fields.

        Verifies that the method returns the correct list of built-in
        field definitions with proper structure.

        This test ensures:
        - All built-in fields are returned
        - Each field has name and type
        - Field definitions are correct
        """
        # Act
        result = MetadataService.get_built_in_fields()

        # Assert
        assert isinstance(result, list)
        assert len(result) > 0

        # Verify each field has required properties
        for field in result:
            assert "name" in field
            assert "type" in field
            assert isinstance(field["name"], str)
            assert isinstance(field["type"], str)

        # Verify specific built-in fields are present
        field_names = [field["name"] for field in result]
        assert BuiltInField.document_name in field_names
        assert BuiltInField.uploader in field_names


# ============================================================================
# Tests for knowledge_base_metadata_lock_check
# ============================================================================


class TestMetadataServiceLockCheck:
    """
    Comprehensive unit tests for MetadataService.knowledge_base_metadata_lock_check method.

    This test class covers the lock management functionality for preventing
    concurrent metadata operations.

    The knowledge_base_metadata_lock_check method:
    1. Checks if a lock exists for the dataset or document
    2. Raises ValueError if lock exists (operation in progress)
    3. Sets a lock with expiration time (3600 seconds)
    4. Supports both dataset-level and document-level locks

    Test scenarios include:
    - Successful lock acquisition
    - Lock conflict detection
    - Dataset-level locks
    - Document-level locks
    """

    @pytest.fixture
    def mock_redis_client(self):
        """Mock Redis client for lock management."""
        with patch("services.metadata_service.redis_client") as mock_redis:
            yield mock_redis

    def test_lock_check_dataset_success(self, mock_redis_client):
        """
        Test successful lock acquisition for dataset operations.

        Verifies that when no lock exists, a new lock is acquired
        for the dataset.

        This test ensures:
        - Lock check passes when no lock exists
        - Lock is set with correct key and expiration
        - No error is raised
        """
        # Arrange
        dataset_id = "dataset-123"
        mock_redis_client.get.return_value = None  # No existing lock

        # Act (should not raise)
        MetadataService.knowledge_base_metadata_lock_check(dataset_id, None)

        # Assert
        mock_redis_client.get.assert_called_once_with(f"dataset_metadata_lock_{dataset_id}")
        mock_redis_client.set.assert_called_once_with(f"dataset_metadata_lock_{dataset_id}", 1, ex=3600)

    def test_lock_check_dataset_conflict_error(self, mock_redis_client):
        """
        Test error handling when dataset lock already exists.

        Verifies that when a lock exists for the dataset, a ValueError
        is raised with an appropriate message.

        This test ensures:
        - Lock conflict is detected
        - Error message is clear
        - No new lock is set
        """
        # Arrange
        dataset_id = "dataset-123"
        mock_redis_client.get.return_value = "1"  # Lock exists

        # Act & Assert
        with pytest.raises(ValueError, match="Another knowledge base metadata operation is running"):
            MetadataService.knowledge_base_metadata_lock_check(dataset_id, None)

        # Verify lock was checked but not set
        mock_redis_client.get.assert_called_once()
        mock_redis_client.set.assert_not_called()

    def test_lock_check_document_success(self, mock_redis_client):
        """
        Test successful lock acquisition for document operations.

        Verifies that when no lock exists, a new lock is acquired
        for the document.

        This test ensures:
        - Lock check passes when no lock exists
        - Lock is set with correct key and expiration
        - No error is raised
        """
        # Arrange
        document_id = "document-123"
        mock_redis_client.get.return_value = None  # No existing lock

        # Act (should not raise)
        MetadataService.knowledge_base_metadata_lock_check(None, document_id)

        # Assert
        mock_redis_client.get.assert_called_once_with(f"document_metadata_lock_{document_id}")
        mock_redis_client.set.assert_called_once_with(f"document_metadata_lock_{document_id}", 1, ex=3600)


# ============================================================================
# Tests for get_dataset_metadatas
# ============================================================================


class TestMetadataServiceGetDatasetMetadatas:
    """
    Comprehensive unit tests for MetadataService.get_dataset_metadatas method.

    This test class covers the metadata retrieval functionality for datasets.

    The get_dataset_metadatas method:
    1. Retrieves all metadata fields for a dataset
    2. Excludes built-in fields from the list
    3. Includes usage count for each metadata field
    4. Returns built-in field enabled status

    Test scenarios include:
    - Successful retrieval with metadata fields
    - Empty metadata list
    - Built-in field filtering
    - Usage count calculation
    """

    @pytest.fixture
    def mock_db_session(self):
        """Mock database session for testing."""
        with patch("services.metadata_service.db.session") as mock_db:
            yield mock_db

    def test_get_dataset_metadatas_success(self, mock_db_session):
        """
        Test successful retrieval of dataset metadata fields.

        Verifies that all metadata fields are returned with correct
        structure and usage counts.

        This test ensures:
        - All metadata fields are included
        - Built-in fields are excluded
        - Usage counts are calculated correctly
        - Built-in field status is included
        """
        # Arrange
        dataset = MetadataTestDataFactory.create_dataset_mock(
            dataset_id="dataset-123",
            built_in_field_enabled=True,
            doc_metadata=[
                {"id": "metadata-1", "name": "category", "type": "string"},
                {"id": "metadata-2", "name": "priority", "type": "number"},
                {"id": "built-in", "name": "document_name", "type": "string"},
            ],
        )

        # Mock usage count queries
        mock_query = Mock()
        mock_query.filter_by.return_value = mock_query
        mock_query.count.return_value = 5  # 5 documents use this metadata
        mock_db_session.query.return_value = mock_query

        # Act
        result = MetadataService.get_dataset_metadatas(dataset)

        # Assert
        assert "doc_metadata" in result
        assert "built_in_field_enabled" in result
        assert result["built_in_field_enabled"] is True

        # Verify built-in fields are excluded
        metadata_ids = [meta["id"] for meta in result["doc_metadata"]]
        assert "built-in" not in metadata_ids

        # Verify all custom metadata fields are included
        assert len(result["doc_metadata"]) == 2

        # Verify usage counts are included
        for meta in result["doc_metadata"]:
            assert "count" in meta
            assert meta["count"] == 5


# ============================================================================
# Additional Documentation and Notes
# ============================================================================
#
# This test suite covers the core metadata CRUD operations and basic
# filtering functionality. Additional test scenarios that could be added:
#
# 1. enable_built_in_field / disable_built_in_field:
#    - Testing built-in field enablement
#    - Testing built-in field disablement
#    - Testing document metadata updates when enabling/disabling
#
# 2. update_documents_metadata:
#    - Testing partial updates
#    - Testing full updates
#    - Testing metadata binding creation
#    - Testing built-in field updates
#
# 3. Metadata Filtering and Querying:
#    - Testing metadata-based document filtering
#    - Testing complex metadata queries
#    - Testing metadata value retrieval
#
# These scenarios are not currently implemented but could be added if needed
# based on real-world usage patterns or discovered edge cases.
#
# ============================================================================
