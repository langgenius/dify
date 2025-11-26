"""
Comprehensive unit tests for DatasetCollectionBindingService.

This module contains extensive unit tests for the DatasetCollectionBindingService class,
which handles dataset collection binding operations for vector database collections.

The DatasetCollectionBindingService provides methods for:
- Retrieving or creating dataset collection bindings by provider, model, and type
- Retrieving specific collection bindings by ID and type
- Managing collection bindings for different collection types (dataset, etc.)

Collection bindings are used to map embedding models (provider + model name) to
specific vector database collections, allowing datasets to share collections when
they use the same embedding model configuration.

This test suite ensures:
- Correct retrieval of existing bindings
- Proper creation of new bindings when they don't exist
- Accurate filtering by provider, model, and collection type
- Proper error handling for missing bindings
- Database transaction handling (add, commit)
- Collection name generation using Dataset.gen_collection_name_by_id
"""

from unittest.mock import Mock, patch
from uuid import uuid4

import pytest

from models.dataset import Dataset, DatasetCollectionBinding
from services.dataset_service import DatasetCollectionBindingService


# ============================================================================
# Test Data Factory
# ============================================================================


class DatasetCollectionBindingTestDataFactory:
    """
    Factory class for creating test data and mock objects for dataset collection binding tests.

    This factory provides static methods to create mock objects for:
    - DatasetCollectionBinding instances
    - Database query results
    - Collection name generation results

    The factory methods help maintain consistency across tests and reduce
    code duplication when setting up test scenarios.
    """

    @staticmethod
    def create_collection_binding_mock(
        binding_id: str = "binding-123",
        provider_name: str = "openai",
        model_name: str = "text-embedding-ada-002",
        collection_name: str = "collection-abc",
        collection_type: str = "dataset",
        created_at=None,
        **kwargs,
    ) -> Mock:
        """
        Create a mock DatasetCollectionBinding with specified attributes.

        Args:
            binding_id: Unique identifier for the binding
            provider_name: Name of the embedding model provider (e.g., "openai", "cohere")
            model_name: Name of the embedding model (e.g., "text-embedding-ada-002")
            collection_name: Name of the vector database collection
            collection_type: Type of collection (default: "dataset")
            created_at: Optional datetime for creation timestamp
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a DatasetCollectionBinding instance
        """
        binding = Mock(spec=DatasetCollectionBinding)
        binding.id = binding_id
        binding.provider_name = provider_name
        binding.model_name = model_name
        binding.collection_name = collection_name
        binding.type = collection_type
        binding.created_at = created_at
        for key, value in kwargs.items():
            setattr(binding, key, value)
        return binding

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Dataset for testing collection name generation.

        Args:
            dataset_id: Unique identifier for the dataset
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a Dataset instance
        """
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset


# ============================================================================
# Tests for get_dataset_collection_binding
# ============================================================================


class TestDatasetCollectionBindingServiceGetBinding:
    """
    Comprehensive unit tests for DatasetCollectionBindingService.get_dataset_collection_binding method.

    This test class covers the main collection binding retrieval/creation functionality,
    including various provider/model combinations, collection types, and edge cases.

    The get_dataset_collection_binding method:
    1. Queries for existing binding by provider_name, model_name, and collection_type
    2. Orders results by created_at (ascending) and takes the first match
    3. If no binding exists, creates a new one with:
       - The provided provider_name and model_name
       - A generated collection_name using Dataset.gen_collection_name_by_id
       - The provided collection_type
    4. Adds the new binding to the database session and commits
    5. Returns the binding (either existing or newly created)

    Test scenarios include:
    - Retrieving existing bindings
    - Creating new bindings when none exist
    - Different collection types
    - Database transaction handling
    - Collection name generation
    """

    @pytest.fixture
    def mock_db_session(self):
        """
        Mock database session for testing database operations.

        Provides a mocked database session that can be used to verify:
        - Query construction and execution
        - Add operations for new bindings
        - Commit operations for transaction completion

        The mock is configured to return a query builder that supports
        chaining operations like .where(), .order_by(), and .first().
        """
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_dataset_collection_binding_existing_binding_success(self, mock_db_session):
        """
        Test successful retrieval of an existing collection binding.

        Verifies that when a binding already exists in the database for the given
        provider, model, and collection type, the method returns the existing binding
        without creating a new one.

        This test ensures:
        - The query is constructed correctly with all three filters
        - Results are ordered by created_at
        - The first matching binding is returned
        - No new binding is created (db.session.add is not called)
        - No commit is performed (db.session.commit is not called)
        """
        # Arrange
        provider_name = "openai"
        model_name = "text-embedding-ada-002"
        collection_type = "dataset"

        existing_binding = DatasetCollectionBindingTestDataFactory.create_collection_binding_mock(
            binding_id="binding-123",
            provider_name=provider_name,
            model_name=model_name,
            collection_type=collection_type,
        )

        # Mock the query chain: query().where().order_by().first()
        mock_query = Mock()
        mock_where = Mock()
        mock_order_by = Mock()
        mock_query.where.return_value = mock_where
        mock_where.order_by.return_value = mock_order_by
        mock_order_by.first.return_value = existing_binding
        mock_db_session.query.return_value = mock_query

        # Act
        result = DatasetCollectionBindingService.get_dataset_collection_binding(
            provider_name=provider_name, model_name=model_name, collection_type=collection_type
        )

        # Assert
        assert result == existing_binding
        assert result.id == "binding-123"
        assert result.provider_name == provider_name
        assert result.model_name == model_name
        assert result.type == collection_type

        # Verify query was constructed correctly
        mock_db_session.query.assert_called_once_with(DatasetCollectionBinding)
        mock_query.where.assert_called_once()
        mock_where.order_by.assert_called_once()

        # Verify no new binding was created
        mock_db_session.add.assert_not_called()
        mock_db_session.commit.assert_not_called()

    def test_get_dataset_collection_binding_create_new_binding_success(self, mock_db_session):
        """
        Test successful creation of a new collection binding when none exists.

        Verifies that when no binding exists in the database for the given
        provider, model, and collection type, the method creates a new binding
        with a generated collection name and commits it to the database.

        This test ensures:
        - The query returns None (no existing binding)
        - A new DatasetCollectionBinding is created with correct attributes
        - Dataset.gen_collection_name_by_id is called to generate collection name
        - The new binding is added to the database session
        - The transaction is committed
        - The newly created binding is returned
        """
        # Arrange
        provider_name = "cohere"
        model_name = "embed-english-v3.0"
        collection_type = "dataset"
        generated_collection_name = "collection-generated-xyz"

        # Mock the query chain to return None (no existing binding)
        mock_query = Mock()
        mock_where = Mock()
        mock_order_by = Mock()
        mock_query.where.return_value = mock_where
        mock_where.order_by.return_value = mock_order_by
        mock_order_by.first.return_value = None  # No existing binding
        mock_db_session.query.return_value = mock_query

        # Mock Dataset.gen_collection_name_by_id to return a generated name
        with patch("services.dataset_service.Dataset.gen_collection_name_by_id") as mock_gen_name:
            mock_gen_name.return_value = generated_collection_name

            # Mock uuid.uuid4 for the collection name generation
            mock_uuid = "test-uuid-123"
            with patch("services.dataset_service.uuid.uuid4", return_value=mock_uuid):
                # Act
                result = DatasetCollectionBindingService.get_dataset_collection_binding(
                    provider_name=provider_name, model_name=model_name, collection_type=collection_type
                )

        # Assert
        assert result is not None
        assert result.provider_name == provider_name
        assert result.model_name == model_name
        assert result.type == collection_type
        assert result.collection_name == generated_collection_name

        # Verify Dataset.gen_collection_name_by_id was called with the generated UUID
        mock_gen_name.assert_called_once_with(str(mock_uuid))

        # Verify new binding was added and committed
        mock_db_session.add.assert_called_once()
        added_binding = mock_db_session.add.call_args[0][0]
        assert isinstance(added_binding, DatasetCollectionBinding)
        assert added_binding.provider_name == provider_name
        assert added_binding.model_name == model_name
        assert added_binding.type == collection_type

        mock_db_session.commit.assert_called_once()

    def test_get_dataset_collection_binding_different_collection_type(self, mock_db_session):
        """
        Test retrieval with a different collection type (not "dataset").

        Verifies that the method correctly filters by collection_type, allowing
        different types of collections to coexist with the same provider/model
        combination.

        This test ensures:
        - Collection type is properly used as a filter in the query
        - Different collection types can have separate bindings
        - The correct binding is returned based on type
        """
        # Arrange
        provider_name = "openai"
        model_name = "text-embedding-ada-002"
        collection_type = "custom_type"

        existing_binding = DatasetCollectionBindingTestDataFactory.create_collection_binding_mock(
            binding_id="binding-456",
            provider_name=provider_name,
            model_name=model_name,
            collection_type=collection_type,
        )

        # Mock the query chain
        mock_query = Mock()
        mock_where = Mock()
        mock_order_by = Mock()
        mock_query.where.return_value = mock_where
        mock_where.order_by.return_value = mock_order_by
        mock_order_by.first.return_value = existing_binding
        mock_db_session.query.return_value = mock_query

        # Act
        result = DatasetCollectionBindingService.get_dataset_collection_binding(
            provider_name=provider_name, model_name=model_name, collection_type=collection_type
        )

        # Assert
        assert result == existing_binding
        assert result.type == collection_type

        # Verify query was constructed with the correct type filter
        mock_db_session.query.assert_called_once_with(DatasetCollectionBinding)
        mock_query.where.assert_called_once()

    def test_get_dataset_collection_binding_default_collection_type(self, mock_db_session):
        """
        Test retrieval with default collection type ("dataset").

        Verifies that when collection_type is not provided, it defaults to "dataset"
        as specified in the method signature.

        This test ensures:
        - The default value "dataset" is used when type is not specified
        - The query correctly filters by the default type
        """
        # Arrange
        provider_name = "openai"
        model_name = "text-embedding-ada-002"
        # collection_type defaults to "dataset" in method signature

        existing_binding = DatasetCollectionBindingTestDataFactory.create_collection_binding_mock(
            binding_id="binding-789",
            provider_name=provider_name,
            model_name=model_name,
            collection_type="dataset",  # Default type
        )

        # Mock the query chain
        mock_query = Mock()
        mock_where = Mock()
        mock_order_by = Mock()
        mock_query.where.return_value = mock_where
        mock_where.order_by.return_value = mock_order_by
        mock_order_by.first.return_value = existing_binding
        mock_db_session.query.return_value = mock_query

        # Act - call without specifying collection_type (uses default)
        result = DatasetCollectionBindingService.get_dataset_collection_binding(
            provider_name=provider_name, model_name=model_name
        )

        # Assert
        assert result == existing_binding
        assert result.type == "dataset"

        # Verify query was constructed correctly
        mock_db_session.query.assert_called_once_with(DatasetCollectionBinding)

    def test_get_dataset_collection_binding_different_provider_model_combination(self, mock_db_session):
        """
        Test retrieval with different provider/model combinations.

        Verifies that bindings are correctly filtered by both provider_name and
        model_name, ensuring that different model combinations have separate bindings.

        This test ensures:
        - Provider and model are both used as filters
        - Different combinations result in different bindings
        - The correct binding is returned for each combination
        """
        # Arrange
        provider_name = "huggingface"
        model_name = "sentence-transformers/all-MiniLM-L6-v2"
        collection_type = "dataset"

        existing_binding = DatasetCollectionBindingTestDataFactory.create_collection_binding_mock(
            binding_id="binding-hf-123",
            provider_name=provider_name,
            model_name=model_name,
            collection_type=collection_type,
        )

        # Mock the query chain
        mock_query = Mock()
        mock_where = Mock()
        mock_order_by = Mock()
        mock_query.where.return_value = mock_where
        mock_where.order_by.return_value = mock_order_by
        mock_order_by.first.return_value = existing_binding
        mock_db_session.query.return_value = mock_query

        # Act
        result = DatasetCollectionBindingService.get_dataset_collection_binding(
            provider_name=provider_name, model_name=model_name, collection_type=collection_type
        )

        # Assert
        assert result == existing_binding
        assert result.provider_name == provider_name
        assert result.model_name == model_name

        # Verify query filters were applied correctly
        mock_db_session.query.assert_called_once_with(DatasetCollectionBinding)
        mock_query.where.assert_called_once()


# ============================================================================
# Tests for get_dataset_collection_binding_by_id_and_type
# ============================================================================


class TestDatasetCollectionBindingServiceGetBindingByIdAndType:
    """
    Comprehensive unit tests for DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type method.

    This test class covers collection binding retrieval by ID and type,
    including success scenarios and error handling for missing bindings.

    The get_dataset_collection_binding_by_id_and_type method:
    1. Queries for a binding by collection_binding_id and collection_type
    2. Orders results by created_at (ascending) and takes the first match
    3. If no binding exists, raises ValueError("Dataset collection binding not found")
    4. Returns the found binding

    Unlike get_dataset_collection_binding, this method does NOT create a new
    binding if one doesn't exist - it only retrieves existing bindings.

    Test scenarios include:
    - Successful retrieval of existing bindings
    - Error handling for missing bindings
    - Different collection types
    - Default collection type behavior
    """

    @pytest.fixture
    def mock_db_session(self):
        """
        Mock database session for testing database operations.

        Provides a mocked database session that can be used to verify:
        - Query construction with ID and type filters
        - Ordering by created_at
        - First result retrieval

        The mock is configured to return a query builder that supports
        chaining operations like .where(), .order_by(), and .first().
        """
        with patch("services.dataset_service.db.session") as mock_db:
            yield mock_db

    def test_get_dataset_collection_binding_by_id_and_type_success(self, mock_db_session):
        """
        Test successful retrieval of a collection binding by ID and type.

        Verifies that when a binding exists in the database with the given
        ID and collection type, the method returns the binding.

        This test ensures:
        - The query is constructed correctly with ID and type filters
        - Results are ordered by created_at
        - The first matching binding is returned
        - No error is raised
        """
        # Arrange
        collection_binding_id = "binding-123"
        collection_type = "dataset"

        existing_binding = DatasetCollectionBindingTestDataFactory.create_collection_binding_mock(
            binding_id=collection_binding_id,
            provider_name="openai",
            model_name="text-embedding-ada-002",
            collection_type=collection_type,
        )

        # Mock the query chain: query().where().order_by().first()
        mock_query = Mock()
        mock_where = Mock()
        mock_order_by = Mock()
        mock_query.where.return_value = mock_where
        mock_where.order_by.return_value = mock_order_by
        mock_order_by.first.return_value = existing_binding
        mock_db_session.query.return_value = mock_query

        # Act
        result = DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(
            collection_binding_id=collection_binding_id, collection_type=collection_type
        )

        # Assert
        assert result == existing_binding
        assert result.id == collection_binding_id
        assert result.type == collection_type

        # Verify query was constructed correctly
        mock_db_session.query.assert_called_once_with(DatasetCollectionBinding)
        mock_query.where.assert_called_once()
        mock_where.order_by.assert_called_once()

    def test_get_dataset_collection_binding_by_id_and_type_not_found_error(self, mock_db_session):
        """
        Test error handling when binding is not found.

        Verifies that when no binding exists in the database with the given
        ID and collection type, the method raises a ValueError with the
        message "Dataset collection binding not found".

        This test ensures:
        - The query returns None (no existing binding)
        - ValueError is raised with the correct message
        - No binding is returned
        """
        # Arrange
        collection_binding_id = "non-existent-binding"
        collection_type = "dataset"

        # Mock the query chain to return None (no existing binding)
        mock_query = Mock()
        mock_where = Mock()
        mock_order_by = Mock()
        mock_query.where.return_value = mock_where
        mock_where.order_by.return_value = mock_order_by
        mock_order_by.first.return_value = None  # No existing binding
        mock_db_session.query.return_value = mock_query

        # Act & Assert
        with pytest.raises(ValueError, match="Dataset collection binding not found"):
            DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(
                collection_binding_id=collection_binding_id, collection_type=collection_type
            )

        # Verify query was attempted
        mock_db_session.query.assert_called_once_with(DatasetCollectionBinding)
        mock_query.where.assert_called_once()

    def test_get_dataset_collection_binding_by_id_and_type_different_collection_type(self, mock_db_session):
        """
        Test retrieval with a different collection type.

        Verifies that the method correctly filters by collection_type, ensuring
        that bindings with the same ID but different types are treated as
        separate entities.

        This test ensures:
        - Collection type is properly used as a filter in the query
        - Different collection types can have separate bindings with same ID
        - The correct binding is returned based on type
        """
        # Arrange
        collection_binding_id = "binding-456"
        collection_type = "custom_type"

        existing_binding = DatasetCollectionBindingTestDataFactory.create_collection_binding_mock(
            binding_id=collection_binding_id,
            provider_name="cohere",
            model_name="embed-english-v3.0",
            collection_type=collection_type,
        )

        # Mock the query chain
        mock_query = Mock()
        mock_where = Mock()
        mock_order_by = Mock()
        mock_query.where.return_value = mock_where
        mock_where.order_by.return_value = mock_order_by
        mock_order_by.first.return_value = existing_binding
        mock_db_session.query.return_value = mock_query

        # Act
        result = DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(
            collection_binding_id=collection_binding_id, collection_type=collection_type
        )

        # Assert
        assert result == existing_binding
        assert result.id == collection_binding_id
        assert result.type == collection_type

        # Verify query was constructed with the correct type filter
        mock_db_session.query.assert_called_once_with(DatasetCollectionBinding)
        mock_query.where.assert_called_once()

    def test_get_dataset_collection_binding_by_id_and_type_default_collection_type(self, mock_db_session):
        """
        Test retrieval with default collection type ("dataset").

        Verifies that when collection_type is not provided, it defaults to "dataset"
        as specified in the method signature.

        This test ensures:
        - The default value "dataset" is used when type is not specified
        - The query correctly filters by the default type
        - The correct binding is returned
        """
        # Arrange
        collection_binding_id = "binding-789"
        # collection_type defaults to "dataset" in method signature

        existing_binding = DatasetCollectionBindingTestDataFactory.create_collection_binding_mock(
            binding_id=collection_binding_id,
            provider_name="openai",
            model_name="text-embedding-ada-002",
            collection_type="dataset",  # Default type
        )

        # Mock the query chain
        mock_query = Mock()
        mock_where = Mock()
        mock_order_by = Mock()
        mock_query.where.return_value = mock_where
        mock_where.order_by.return_value = mock_order_by
        mock_order_by.first.return_value = existing_binding
        mock_db_session.query.return_value = mock_query

        # Act - call without specifying collection_type (uses default)
        result = DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(
            collection_binding_id=collection_binding_id
        )

        # Assert
        assert result == existing_binding
        assert result.id == collection_binding_id
        assert result.type == "dataset"

        # Verify query was constructed correctly
        mock_db_session.query.assert_called_once_with(DatasetCollectionBinding)
        mock_query.where.assert_called_once()

    def test_get_dataset_collection_binding_by_id_and_type_wrong_type_error(self, mock_db_session):
        """
        Test error handling when binding exists but with wrong collection type.

        Verifies that when a binding exists with the given ID but a different
        collection type, the method raises a ValueError because the binding
        doesn't match both the ID and type criteria.

        This test ensures:
        - The query correctly filters by both ID and type
        - Bindings with matching ID but different type are not returned
        - ValueError is raised when no matching binding is found
        """
        # Arrange
        collection_binding_id = "binding-123"
        collection_type = "dataset"

        # Mock the query chain to return None (binding exists but with different type)
        mock_query = Mock()
        mock_where = Mock()
        mock_order_by = Mock()
        mock_query.where.return_value = mock_where
        mock_where.order_by.return_value = mock_order_by
        mock_order_by.first.return_value = None  # No matching binding
        mock_db_session.query.return_value = mock_query

        # Act & Assert
        with pytest.raises(ValueError, match="Dataset collection binding not found"):
            DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(
                collection_binding_id=collection_binding_id, collection_type=collection_type
            )

        # Verify query was attempted with both ID and type filters
        mock_db_session.query.assert_called_once_with(DatasetCollectionBinding)
        mock_query.where.assert_called_once()

