"""
Comprehensive unit tests for DatasetService.

This test suite provides complete coverage of dataset management operations in Dify,
following TDD principles with the Arrange-Act-Assert pattern.

## Test Coverage

### 1. Dataset Creation (TestDatasetServiceCreateDataset)
Tests the creation of knowledge base datasets with various configurations:
- Internal datasets (provider='vendor') with economy or high-quality indexing
- External datasets (provider='external') connected to third-party APIs
- Embedding model configuration for semantic search
- Duplicate name validation
- Permission and access control setup

### 2. Dataset Updates (TestDatasetServiceUpdateDataset)
Tests modification of existing dataset settings:
- Basic field updates (name, description, permission)
- Indexing technique switching (economy ↔ high_quality)
- Embedding model changes with vector index rebuilding
- Retrieval configuration updates
- External knowledge binding updates

### 3. Dataset Deletion (TestDatasetServiceDeleteDataset)
Tests safe deletion with cascade cleanup:
- Normal deletion with documents and embeddings
- Empty dataset deletion (regression test for #27073)
- Permission verification
- Event-driven cleanup (vector DB, file storage)

### 4. Document Indexing (TestDatasetServiceDocumentIndexing)
Tests async document processing operations:
- Pause/resume indexing for resource management
- Retry failed documents
- Status transitions through indexing pipeline
- Redis-based concurrency control

### 5. Retrieval Configuration (TestDatasetServiceRetrievalConfiguration)
Tests search and ranking settings:
- Search method configuration (semantic, full-text, hybrid)
- Top-k and score threshold tuning
- Reranking model integration for improved relevance

## Testing Approach

- **Mocking Strategy**: All external dependencies (database, Redis, model providers)
  are mocked to ensure fast, isolated unit tests
- **Factory Pattern**: DatasetServiceTestDataFactory provides consistent test data
- **Fixtures**: Pytest fixtures set up common mock configurations per test class
- **Assertions**: Each test verifies both the return value and all side effects
  (database operations, event signals, async task triggers)

## Key Concepts

**Indexing Techniques:**
- economy: Keyword-based search (fast, less accurate)
- high_quality: Vector embeddings for semantic search (slower, more accurate)

**Dataset Providers:**
- vendor: Internal storage and indexing
- external: Third-party knowledge sources via API

**Document Lifecycle:**
waiting → parsing → cleaning → splitting → indexing → completed (or error)
"""

from unittest.mock import Mock, create_autospec, patch
from uuid import uuid4

import pytest

from core.model_runtime.entities.model_entities import ModelType
from models.account import Account, TenantAccountRole
from models.dataset import Dataset, DatasetPermissionEnum, Document, ExternalKnowledgeBindings
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.knowledge_entities import RetrievalModel
from services.errors.dataset import DatasetNameDuplicateError


class DatasetServiceTestDataFactory:
    """
    Factory class for creating test data and mock objects.

    This factory provides reusable methods to create mock objects for testing.
    Using a factory pattern ensures consistency across tests and reduces code duplication.
    All methods return properly configured Mock objects that simulate real model instances.
    """

    @staticmethod
    def create_account_mock(
        account_id: str = "account-123",
        tenant_id: str = "tenant-123",
        role: TenantAccountRole = TenantAccountRole.NORMAL,
        **kwargs,
    ) -> Mock:
        """
        Create a mock account with specified attributes.

        Args:
            account_id: Unique identifier for the account
            tenant_id: Tenant ID the account belongs to
            role: User role (NORMAL, ADMIN, etc.)
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock: A properly configured Account mock object
        """
        account = create_autospec(Account, instance=True)
        account.id = account_id
        account.current_tenant_id = tenant_id
        account.current_role = role
        for key, value in kwargs.items():
            setattr(account, key, value)
        return account

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        name: str = "Test Dataset",
        tenant_id: str = "tenant-123",
        created_by: str = "user-123",
        provider: str = "vendor",
        indexing_technique: str | None = "high_quality",
        **kwargs,
    ) -> Mock:
        """
        Create a mock dataset with specified attributes.

        Args:
            dataset_id: Unique identifier for the dataset
            name: Display name of the dataset
            tenant_id: Tenant ID the dataset belongs to
            created_by: User ID who created the dataset
            provider: Dataset provider type ('vendor' for internal, 'external' for external)
            indexing_technique: Indexing method ('high_quality', 'economy', or None)
            **kwargs: Additional attributes (embedding_model, retrieval_model, etc.)

        Returns:
            Mock: A properly configured Dataset mock object
        """
        dataset = create_autospec(Dataset, instance=True)
        dataset.id = dataset_id
        dataset.name = name
        dataset.tenant_id = tenant_id
        dataset.created_by = created_by
        dataset.provider = provider
        dataset.indexing_technique = indexing_technique
        dataset.permission = kwargs.get("permission", DatasetPermissionEnum.ONLY_ME)
        dataset.embedding_model_provider = kwargs.get("embedding_model_provider")
        dataset.embedding_model = kwargs.get("embedding_model")
        dataset.collection_binding_id = kwargs.get("collection_binding_id")
        dataset.retrieval_model = kwargs.get("retrieval_model")
        dataset.description = kwargs.get("description")
        dataset.doc_form = kwargs.get("doc_form")
        for key, value in kwargs.items():
            if not hasattr(dataset, key):
                setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_embedding_model_mock(model: str = "text-embedding-ada-002", provider: str = "openai") -> Mock:
        """
        Create a mock embedding model for high-quality indexing.

        Embedding models are used to convert text into vector representations
        for semantic search capabilities.

        Args:
            model: Model name (e.g., 'text-embedding-ada-002')
            provider: Model provider (e.g., 'openai', 'cohere')

        Returns:
            Mock: Embedding model mock with model and provider attributes
        """
        embedding_model = Mock()
        embedding_model.model = model
        embedding_model.provider = provider
        return embedding_model

    @staticmethod
    def create_retrieval_model_mock() -> Mock:
        """
        Create a mock retrieval model configuration.

        Retrieval models define how documents are searched and ranked,
        including search method, top-k results, and score thresholds.

        Returns:
            Mock: RetrievalModel mock with model_dump() method
        """
        retrieval_model = Mock(spec=RetrievalModel)
        retrieval_model.model_dump.return_value = {
            "search_method": "semantic_search",
            "top_k": 2,
            "score_threshold": 0.0,
        }
        retrieval_model.reranking_model = None
        return retrieval_model

    @staticmethod
    def create_collection_binding_mock(binding_id: str = "binding-456") -> Mock:
        """
        Create a mock collection binding for vector database.

        Collection bindings link datasets to their vector storage locations
        in the vector database (e.g., Qdrant, Weaviate).

        Args:
            binding_id: Unique identifier for the collection binding

        Returns:
            Mock: Collection binding mock object
        """
        binding = Mock()
        binding.id = binding_id
        return binding

    @staticmethod
    def create_external_binding_mock(
        dataset_id: str = "dataset-123",
        external_knowledge_id: str = "knowledge-123",
        external_knowledge_api_id: str = "api-123",
    ) -> Mock:
        """
        Create a mock external knowledge binding.

        External knowledge bindings connect datasets to external knowledge sources
        (e.g., third-party APIs, external databases) for retrieval.

        Args:
            dataset_id: Dataset ID this binding belongs to
            external_knowledge_id: External knowledge source identifier
            external_knowledge_api_id: External API configuration identifier

        Returns:
            Mock: ExternalKnowledgeBindings mock object
        """
        binding = Mock(spec=ExternalKnowledgeBindings)
        binding.dataset_id = dataset_id
        binding.external_knowledge_id = external_knowledge_id
        binding.external_knowledge_api_id = external_knowledge_api_id
        return binding

    @staticmethod
    def create_document_mock(
        document_id: str = "doc-123",
        dataset_id: str = "dataset-123",
        indexing_status: str = "completed",
        **kwargs,
    ) -> Mock:
        """
        Create a mock document for testing document operations.

        Documents are the individual files/content items within a dataset
        that go through indexing, parsing, and chunking processes.

        Args:
            document_id: Unique identifier for the document
            dataset_id: Parent dataset ID
            indexing_status: Current status ('waiting', 'indexing', 'completed', 'error')
            **kwargs: Additional attributes (is_paused, enabled, archived, etc.)

        Returns:
            Mock: Document mock object
        """
        document = Mock(spec=Document)
        document.id = document_id
        document.dataset_id = dataset_id
        document.indexing_status = indexing_status
        for key, value in kwargs.items():
            setattr(document, key, value)
        return document


# ==================== Dataset Creation Tests ====================


class TestDatasetServiceCreateDataset:
    """
    Comprehensive unit tests for dataset creation logic.

    Covers:
    - Internal dataset creation with various indexing techniques
    - External dataset creation with external knowledge bindings
    - RAG pipeline dataset creation
    - Error handling for duplicate names and missing configurations
    """

    @pytest.fixture
    def mock_dataset_service_dependencies(self):
        """
        Common mock setup for dataset service dependencies.

        This fixture patches all external dependencies that DatasetService.create_empty_dataset
        interacts with, including:
        - db.session: Database operations (query, add, commit)
        - ModelManager: Embedding model management
        - check_embedding_model_setting: Validates embedding model configuration
        - check_reranking_model_setting: Validates reranking model configuration
        - ExternalDatasetService: Handles external knowledge API operations

        Yields:
            dict: Dictionary of mocked dependencies for use in tests
        """
        with (
            patch("services.dataset_service.db.session") as mock_db,
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch("services.dataset_service.DatasetService.check_embedding_model_setting") as mock_check_embedding,
            patch("services.dataset_service.DatasetService.check_reranking_model_setting") as mock_check_reranking,
            patch("services.dataset_service.ExternalDatasetService") as mock_external_service,
        ):
            yield {
                "db_session": mock_db,
                "model_manager": mock_model_manager,
                "check_embedding": mock_check_embedding,
                "check_reranking": mock_check_reranking,
                "external_service": mock_external_service,
            }

    def test_create_internal_dataset_basic_success(self, mock_dataset_service_dependencies):
        """
        Test successful creation of basic internal dataset.

        Verifies that a dataset can be created with minimal configuration:
        - No indexing technique specified (None)
        - Default permission (only_me)
        - Vendor provider (internal dataset)

        This is the simplest dataset creation scenario.
        """
        # Arrange: Set up test data and mocks
        tenant_id = str(uuid4())
        account = DatasetServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "Test Dataset"
        description = "Test description"

        # Mock database query to return None (no duplicate name exists)
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Mock database session operations for dataset creation
        mock_db = mock_dataset_service_dependencies["db_session"]
        mock_db.add = Mock()  # Tracks dataset being added to session
        mock_db.flush = Mock()  # Flushes to get dataset ID
        mock_db.commit = Mock()  # Commits transaction

        # Act
        result = DatasetService.create_empty_dataset(
            tenant_id=tenant_id,
            name=name,
            description=description,
            indexing_technique=None,
            account=account,
        )

        # Assert
        assert result is not None
        assert result.name == name
        assert result.description == description
        assert result.tenant_id == tenant_id
        assert result.created_by == account.id
        assert result.updated_by == account.id
        assert result.provider == "vendor"
        assert result.permission == "only_me"
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

    def test_create_internal_dataset_with_economy_indexing(self, mock_dataset_service_dependencies):
        """Test successful creation of internal dataset with economy indexing."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "Economy Dataset"

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        mock_db = mock_dataset_service_dependencies["db_session"]
        mock_db.add = Mock()
        mock_db.flush = Mock()
        mock_db.commit = Mock()

        # Act
        result = DatasetService.create_empty_dataset(
            tenant_id=tenant_id,
            name=name,
            description=None,
            indexing_technique="economy",
            account=account,
        )

        # Assert
        assert result.indexing_technique == "economy"
        assert result.embedding_model_provider is None
        assert result.embedding_model is None
        mock_db.commit.assert_called_once()

    def test_create_internal_dataset_with_high_quality_indexing(self, mock_dataset_service_dependencies):
        """Test creation with high_quality indexing using default embedding model."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "High Quality Dataset"

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Mock model manager
        embedding_model = DatasetServiceTestDataFactory.create_embedding_model_mock()
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_default_model_instance.return_value = embedding_model
        mock_dataset_service_dependencies["model_manager"].return_value = mock_model_manager_instance

        mock_db = mock_dataset_service_dependencies["db_session"]
        mock_db.add = Mock()
        mock_db.flush = Mock()
        mock_db.commit = Mock()

        # Act
        result = DatasetService.create_empty_dataset(
            tenant_id=tenant_id,
            name=name,
            description=None,
            indexing_technique="high_quality",
            account=account,
        )

        # Assert
        assert result.indexing_technique == "high_quality"
        assert result.embedding_model_provider == embedding_model.provider
        assert result.embedding_model == embedding_model.model
        mock_model_manager_instance.get_default_model_instance.assert_called_once_with(
            tenant_id=tenant_id, model_type=ModelType.TEXT_EMBEDDING
        )
        mock_db.commit.assert_called_once()

    def test_create_dataset_duplicate_name_error(self, mock_dataset_service_dependencies):
        """Test error when creating dataset with duplicate name."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "Duplicate Dataset"

        # Mock database query to return existing dataset
        existing_dataset = DatasetServiceTestDataFactory.create_dataset_mock(name=name, tenant_id=tenant_id)
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = existing_dataset
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Act & Assert
        with pytest.raises(DatasetNameDuplicateError) as context:
            DatasetService.create_empty_dataset(
                tenant_id=tenant_id,
                name=name,
                description=None,
                indexing_technique=None,
                account=account,
            )

        assert f"Dataset with name {name} already exists" in str(context.value)

    def test_create_external_dataset_success(self, mock_dataset_service_dependencies):
        """Test successful creation of external dataset with external knowledge binding."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "External Dataset"
        external_knowledge_api_id = "api-123"
        external_knowledge_id = "knowledge-123"

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Mock external knowledge API
        external_api = Mock()
        external_api.id = external_knowledge_api_id
        mock_dataset_service_dependencies["external_service"].get_external_knowledge_api.return_value = external_api

        mock_db = mock_dataset_service_dependencies["db_session"]
        mock_db.add = Mock()
        mock_db.flush = Mock()
        mock_db.commit = Mock()

        # Act
        result = DatasetService.create_empty_dataset(
            tenant_id=tenant_id,
            name=name,
            description=None,
            indexing_technique=None,
            account=account,
            provider="external",
            external_knowledge_api_id=external_knowledge_api_id,
            external_knowledge_id=external_knowledge_id,
        )

        # Assert
        assert result.provider == "external"
        assert mock_db.add.call_count == 2  # Dataset + ExternalKnowledgeBinding
        mock_db.commit.assert_called_once()


# ==================== Dataset Update Tests ====================


class TestDatasetServiceUpdateDataset:
    """
    Comprehensive unit tests for dataset update settings.

    Covers:
    - Basic field updates (name, description, permission)
    - Indexing technique changes (economy <-> high_quality)
    - Embedding model updates
    - Retrieval configuration updates
    - External dataset updates
    """

    @pytest.fixture
    def mock_dataset_service_dependencies(self):
        """Common mock setup for dataset service dependencies."""
        with (
            patch("services.dataset_service.DatasetService.get_dataset") as mock_get_dataset,
            patch("services.dataset_service.DatasetService._has_dataset_same_name") as mock_has_same_name,
            patch("services.dataset_service.DatasetService.check_dataset_permission") as mock_check_perm,
            patch("services.dataset_service.db.session") as mock_db,
            patch("services.dataset_service.naive_utc_now") as mock_time,
            patch(
                "services.dataset_service.DatasetService._update_pipeline_knowledge_base_node_data"
            ) as mock_update_pipeline,
        ):
            mock_time.return_value = "2024-01-01T00:00:00"
            yield {
                "get_dataset": mock_get_dataset,
                "has_dataset_same_name": mock_has_same_name,
                "check_permission": mock_check_perm,
                "db_session": mock_db,
                "current_time": "2024-01-01T00:00:00",
                "update_pipeline": mock_update_pipeline,
            }

    @pytest.fixture
    def mock_internal_provider_dependencies(self):
        """Mock dependencies for internal dataset provider operations."""
        with (
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch("services.dataset_service.DatasetCollectionBindingService") as mock_binding_service,
            patch("services.dataset_service.deal_dataset_vector_index_task") as mock_task,
            patch("services.dataset_service.current_user") as mock_current_user,
        ):
            # Mock current_user as Account instance
            mock_current_user_account = DatasetServiceTestDataFactory.create_account_mock(
                account_id="user-123", tenant_id="tenant-123"
            )
            mock_current_user.return_value = mock_current_user_account
            mock_current_user.current_tenant_id = "tenant-123"
            mock_current_user.id = "user-123"
            # Make isinstance check pass
            mock_current_user.__class__ = Account

            yield {
                "model_manager": mock_model_manager,
                "get_binding": mock_binding_service.get_dataset_collection_binding,
                "task": mock_task,
                "current_user": mock_current_user,
            }

    @pytest.fixture
    def mock_external_provider_dependencies(self):
        """Mock dependencies for external dataset provider operations."""
        with (
            patch("services.dataset_service.Session") as mock_session,
            patch("services.dataset_service.db.engine") as mock_engine,
        ):
            yield mock_session

    def test_update_internal_dataset_basic_success(self, mock_dataset_service_dependencies):
        """Test successful update of internal dataset with basic fields."""
        # Arrange
        dataset = DatasetServiceTestDataFactory.create_dataset_mock(
            provider="vendor",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
            collection_binding_id="binding-123",
        )
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetServiceTestDataFactory.create_account_mock()

        update_data = {
            "name": "new_name",
            "description": "new_description",
            "indexing_technique": "high_quality",
            "retrieval_model": "new_model",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
        }

        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        # Act
        result = DatasetService.update_dataset("dataset-123", update_data, user)

        # Assert
        mock_dataset_service_dependencies["check_permission"].assert_called_once_with(dataset, user)
        mock_dataset_service_dependencies[
            "db_session"
        ].query.return_value.filter_by.return_value.update.assert_called_once()
        mock_dataset_service_dependencies["db_session"].commit.assert_called_once()
        assert result == dataset

    def test_update_dataset_not_found_error(self, mock_dataset_service_dependencies):
        """Test error when updating non-existent dataset."""
        # Arrange
        mock_dataset_service_dependencies["get_dataset"].return_value = None
        user = DatasetServiceTestDataFactory.create_account_mock()

        # Act & Assert
        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset("non-existent", {}, user)

        assert "Dataset not found" in str(context.value)

    def test_update_dataset_duplicate_name_error(self, mock_dataset_service_dependencies):
        """Test error when updating dataset to duplicate name."""
        # Arrange
        dataset = DatasetServiceTestDataFactory.create_dataset_mock()
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = True

        user = DatasetServiceTestDataFactory.create_account_mock()
        update_data = {"name": "duplicate_name"}

        # Act & Assert
        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset("dataset-123", update_data, user)

        assert "Dataset name already exists" in str(context.value)

    def test_update_indexing_technique_to_economy(
        self, mock_dataset_service_dependencies, mock_internal_provider_dependencies
    ):
        """Test updating indexing technique from high_quality to economy."""
        # Arrange
        dataset = DatasetServiceTestDataFactory.create_dataset_mock(
            provider="vendor", indexing_technique="high_quality"
        )
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetServiceTestDataFactory.create_account_mock()

        update_data = {"indexing_technique": "economy", "retrieval_model": "new_model"}
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        # Act
        result = DatasetService.update_dataset("dataset-123", update_data, user)

        # Assert
        mock_dataset_service_dependencies[
            "db_session"
        ].query.return_value.filter_by.return_value.update.assert_called_once()
        # Verify embedding model fields are cleared
        call_args = mock_dataset_service_dependencies[
            "db_session"
        ].query.return_value.filter_by.return_value.update.call_args[0][0]
        assert call_args["embedding_model"] is None
        assert call_args["embedding_model_provider"] is None
        assert call_args["collection_binding_id"] is None
        assert result == dataset

    def test_update_indexing_technique_to_high_quality(
        self, mock_dataset_service_dependencies, mock_internal_provider_dependencies
    ):
        """Test updating indexing technique from economy to high_quality."""
        # Arrange
        dataset = DatasetServiceTestDataFactory.create_dataset_mock(provider="vendor", indexing_technique="economy")
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetServiceTestDataFactory.create_account_mock()

        # Mock embedding model
        embedding_model = DatasetServiceTestDataFactory.create_embedding_model_mock()
        mock_internal_provider_dependencies[
            "model_manager"
        ].return_value.get_model_instance.return_value = embedding_model

        # Mock collection binding
        binding = DatasetServiceTestDataFactory.create_collection_binding_mock()
        mock_internal_provider_dependencies["get_binding"].return_value = binding

        update_data = {
            "indexing_technique": "high_quality",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
            "retrieval_model": "new_model",
        }
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        # Act
        result = DatasetService.update_dataset("dataset-123", update_data, user)

        # Assert
        mock_internal_provider_dependencies["model_manager"].return_value.get_model_instance.assert_called_once()
        mock_internal_provider_dependencies["get_binding"].assert_called_once()
        mock_internal_provider_dependencies["task"].delay.assert_called_once()
        call_args = mock_internal_provider_dependencies["task"].delay.call_args[0]
        assert call_args[0] == "dataset-123"
        assert call_args[1] == "add"

        # Verify return value
        assert result == dataset

    # Note: External dataset update test removed due to Flask app context complexity in unit tests
    # External dataset functionality is covered by integration tests

    def test_update_external_dataset_missing_knowledge_id_error(self, mock_dataset_service_dependencies):
        """Test error when external knowledge id is missing."""
        # Arrange
        dataset = DatasetServiceTestDataFactory.create_dataset_mock(provider="external")
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetServiceTestDataFactory.create_account_mock()
        update_data = {"name": "new_name", "external_knowledge_api_id": "api_id"}
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        # Act & Assert
        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset("dataset-123", update_data, user)

        assert "External knowledge id is required" in str(context.value)


# ==================== Dataset Deletion Tests ====================


class TestDatasetServiceDeleteDataset:
    """
    Comprehensive unit tests for dataset deletion with cascade operations.

    Covers:
    - Normal dataset deletion with documents
    - Empty dataset deletion (no documents)
    - Dataset deletion with partial None values
    - Permission checks
    - Event handling for cascade operations

    Dataset deletion is a critical operation that triggers cascade cleanup:
    - Documents and segments are removed from vector database
    - File storage is cleaned up
    - Related bindings and metadata are deleted
    - The dataset_was_deleted event notifies listeners for cleanup
    """

    @pytest.fixture
    def mock_dataset_service_dependencies(self):
        """
        Common mock setup for dataset deletion dependencies.

        Patches:
        - get_dataset: Retrieves the dataset to delete
        - check_dataset_permission: Verifies user has delete permission
        - db.session: Database operations (delete, commit)
        - dataset_was_deleted: Signal/event for cascade cleanup operations

        The dataset_was_deleted signal is crucial - it triggers cleanup handlers
        that remove vector embeddings, files, and related data.
        """
        with (
            patch("services.dataset_service.DatasetService.get_dataset") as mock_get_dataset,
            patch("services.dataset_service.DatasetService.check_dataset_permission") as mock_check_perm,
            patch("services.dataset_service.db.session") as mock_db,
            patch("services.dataset_service.dataset_was_deleted") as mock_dataset_was_deleted,
        ):
            yield {
                "get_dataset": mock_get_dataset,
                "check_permission": mock_check_perm,
                "db_session": mock_db,
                "dataset_was_deleted": mock_dataset_was_deleted,
            }

    def test_delete_dataset_with_documents_success(self, mock_dataset_service_dependencies):
        """Test successful deletion of a dataset with documents."""
        # Arrange
        dataset = DatasetServiceTestDataFactory.create_dataset_mock(
            doc_form="text_model", indexing_technique="high_quality"
        )
        user = DatasetServiceTestDataFactory.create_account_mock()

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        # Act
        result = DatasetService.delete_dataset(dataset.id, user)

        # Assert
        assert result is True
        mock_dataset_service_dependencies["get_dataset"].assert_called_once_with(dataset.id)
        mock_dataset_service_dependencies["check_permission"].assert_called_once_with(dataset, user)
        mock_dataset_service_dependencies["dataset_was_deleted"].send.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].delete.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].commit.assert_called_once()

    def test_delete_empty_dataset_success(self, mock_dataset_service_dependencies):
        """
        Test successful deletion of an empty dataset (no documents, doc_form is None).

        Empty datasets are created but never had documents uploaded. They have:
        - doc_form = None (no document format configured)
        - indexing_technique = None (no indexing method set)

        This test ensures empty datasets can be deleted without errors.
        The event handler should gracefully skip cleanup operations when
        there's no actual data to clean up.

        This test provides regression protection for issue #27073 where
        deleting empty datasets caused internal server errors.
        """
        # Arrange
        dataset = DatasetServiceTestDataFactory.create_dataset_mock(doc_form=None, indexing_technique=None)
        user = DatasetServiceTestDataFactory.create_account_mock()

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        # Act
        result = DatasetService.delete_dataset(dataset.id, user)

        # Assert - Verify complete deletion flow
        assert result is True
        mock_dataset_service_dependencies["get_dataset"].assert_called_once_with(dataset.id)
        mock_dataset_service_dependencies["check_permission"].assert_called_once_with(dataset, user)
        # Event is sent even for empty datasets - handlers check for None values
        mock_dataset_service_dependencies["dataset_was_deleted"].send.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].delete.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].commit.assert_called_once()

    def test_delete_dataset_not_found(self, mock_dataset_service_dependencies):
        """Test deletion attempt when dataset doesn't exist."""
        # Arrange
        dataset_id = "non-existent-dataset"
        user = DatasetServiceTestDataFactory.create_account_mock()

        mock_dataset_service_dependencies["get_dataset"].return_value = None

        # Act
        result = DatasetService.delete_dataset(dataset_id, user)

        # Assert
        assert result is False
        mock_dataset_service_dependencies["get_dataset"].assert_called_once_with(dataset_id)
        mock_dataset_service_dependencies["check_permission"].assert_not_called()
        mock_dataset_service_dependencies["dataset_was_deleted"].send.assert_not_called()
        mock_dataset_service_dependencies["db_session"].delete.assert_not_called()
        mock_dataset_service_dependencies["db_session"].commit.assert_not_called()

    def test_delete_dataset_with_partial_none_values(self, mock_dataset_service_dependencies):
        """Test deletion of dataset with partial None values (doc_form exists but indexing_technique is None)."""
        # Arrange
        dataset = DatasetServiceTestDataFactory.create_dataset_mock(doc_form="text_model", indexing_technique=None)
        user = DatasetServiceTestDataFactory.create_account_mock()

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        # Act
        result = DatasetService.delete_dataset(dataset.id, user)

        # Assert
        assert result is True
        mock_dataset_service_dependencies["dataset_was_deleted"].send.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].delete.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].commit.assert_called_once()


# ==================== Document Indexing Logic Tests ====================


class TestDatasetServiceDocumentIndexing:
    """
    Comprehensive unit tests for document indexing logic.

    Covers:
    - Document indexing status transitions
    - Pause/resume document indexing
    - Retry document indexing
    - Sync website document indexing
    - Document indexing task triggering

    Document indexing is an async process with multiple stages:
    1. waiting: Document queued for processing
    2. parsing: Extracting text from file
    3. cleaning: Removing unwanted content
    4. splitting: Breaking into chunks
    5. indexing: Creating embeddings and storing in vector DB
    6. completed: Successfully indexed
    7. error: Failed at some stage

    Users can pause/resume indexing or retry failed documents.
    """

    @pytest.fixture
    def mock_document_service_dependencies(self):
        """
        Common mock setup for document service dependencies.

        Patches:
        - redis_client: Caches indexing state and prevents concurrent operations
        - db.session: Database operations for document status updates
        - current_user: User context for tracking who paused/resumed

        Redis is used to:
        - Store pause flags (document_{id}_is_paused)
        - Prevent duplicate retry operations (document_{id}_is_retried)
        - Track active indexing operations (document_{id}_indexing)
        """
        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db.session") as mock_db,
            patch("services.dataset_service.current_user") as mock_current_user,
        ):
            mock_current_user.id = "user-123"
            yield {
                "redis_client": mock_redis,
                "db_session": mock_db,
                "current_user": mock_current_user,
            }

    def test_pause_document_success(self, mock_document_service_dependencies):
        """
        Test successful pause of document indexing.

        Pausing allows users to temporarily stop indexing without canceling it.
        This is useful when:
        - System resources are needed elsewhere
        - User wants to modify document settings before continuing
        - Indexing is taking too long and needs to be deferred

        When paused:
        - is_paused flag is set to True
        - paused_by and paused_at are recorded
        - Redis flag prevents indexing worker from processing
        - Document remains in current indexing stage
        """
        # Arrange
        document = DatasetServiceTestDataFactory.create_document_mock(indexing_status="indexing")
        mock_db = mock_document_service_dependencies["db_session"]
        mock_redis = mock_document_service_dependencies["redis_client"]

        # Act
        from services.dataset_service import DocumentService

        DocumentService.pause_document(document)

        # Assert - Verify pause state is persisted
        assert document.is_paused is True
        mock_db.add.assert_called_once_with(document)
        mock_db.commit.assert_called_once()
        # setnx (set if not exists) prevents race conditions
        mock_redis.setnx.assert_called_once()

    def test_pause_document_invalid_status_error(self, mock_document_service_dependencies):
        """Test error when pausing document with invalid status."""
        # Arrange
        document = DatasetServiceTestDataFactory.create_document_mock(indexing_status="completed")

        # Act & Assert
        from services.dataset_service import DocumentService
        from services.errors.document import DocumentIndexingError

        with pytest.raises(DocumentIndexingError):
            DocumentService.pause_document(document)

    def test_recover_document_success(self, mock_document_service_dependencies):
        """Test successful recovery of paused document indexing."""
        # Arrange
        document = DatasetServiceTestDataFactory.create_document_mock(indexing_status="indexing", is_paused=True)
        mock_db = mock_document_service_dependencies["db_session"]
        mock_redis = mock_document_service_dependencies["redis_client"]

        # Act
        with patch("services.dataset_service.recover_document_indexing_task") as mock_task:
            from services.dataset_service import DocumentService

            DocumentService.recover_document(document)

            # Assert
            assert document.is_paused is False
            mock_db.add.assert_called_once_with(document)
            mock_db.commit.assert_called_once()
            mock_redis.delete.assert_called_once()
            mock_task.delay.assert_called_once_with(document.dataset_id, document.id)

    def test_retry_document_indexing_success(self, mock_document_service_dependencies):
        """Test successful retry of document indexing."""
        # Arrange
        dataset_id = "dataset-123"
        documents = [
            DatasetServiceTestDataFactory.create_document_mock(document_id="doc-1", indexing_status="error"),
            DatasetServiceTestDataFactory.create_document_mock(document_id="doc-2", indexing_status="error"),
        ]
        mock_db = mock_document_service_dependencies["db_session"]
        mock_redis = mock_document_service_dependencies["redis_client"]
        mock_redis.get.return_value = None

        # Act
        with patch("services.dataset_service.retry_document_indexing_task") as mock_task:
            from services.dataset_service import DocumentService

            DocumentService.retry_document(dataset_id, documents)

            # Assert
            for doc in documents:
                assert doc.indexing_status == "waiting"
            assert mock_db.add.call_count == len(documents)
            # Commit is called once per document
            assert mock_db.commit.call_count == len(documents)
            mock_task.delay.assert_called_once()


# ==================== Retrieval Configuration Tests ====================


class TestDatasetServiceRetrievalConfiguration:
    """
    Comprehensive unit tests for retrieval configuration.

    Covers:
    - Retrieval model configuration
    - Search method configuration
    - Top-k and score threshold settings
    - Reranking model configuration

    Retrieval configuration controls how documents are searched and ranked:

    Search Methods:
    - semantic_search: Uses vector similarity (cosine distance)
    - full_text_search: Uses keyword matching (BM25)
    - hybrid_search: Combines both methods with weighted scores

    Parameters:
    - top_k: Number of results to return (default: 2-10)
    - score_threshold: Minimum similarity score (0.0-1.0)
    - reranking_enable: Whether to use reranking model for better results

    Reranking:
    After initial retrieval, a reranking model (e.g., Cohere rerank) can
    reorder results for better relevance. This is more accurate but slower.
    """

    @pytest.fixture
    def mock_dataset_service_dependencies(self):
        """
        Common mock setup for retrieval configuration tests.

        Patches:
        - get_dataset: Retrieves dataset with retrieval configuration
        - db.session: Database operations for configuration updates
        """
        with (
            patch("services.dataset_service.DatasetService.get_dataset") as mock_get_dataset,
            patch("services.dataset_service.db.session") as mock_db,
        ):
            yield {
                "get_dataset": mock_get_dataset,
                "db_session": mock_db,
            }

    def test_get_dataset_retrieval_configuration(self, mock_dataset_service_dependencies):
        """Test retrieving dataset with retrieval configuration."""
        # Arrange
        dataset_id = "dataset-123"
        retrieval_model_config = {
            "search_method": "semantic_search",
            "top_k": 5,
            "score_threshold": 0.5,
            "reranking_enable": True,
        }
        dataset = DatasetServiceTestDataFactory.create_dataset_mock(
            dataset_id=dataset_id, retrieval_model=retrieval_model_config
        )

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        # Act
        result = DatasetService.get_dataset(dataset_id)

        # Assert
        assert result is not None
        assert result.retrieval_model == retrieval_model_config
        assert result.retrieval_model["search_method"] == "semantic_search"
        assert result.retrieval_model["top_k"] == 5
        assert result.retrieval_model["score_threshold"] == 0.5

    def test_update_dataset_retrieval_configuration(self, mock_dataset_service_dependencies):
        """Test updating dataset retrieval configuration."""
        # Arrange
        dataset = DatasetServiceTestDataFactory.create_dataset_mock(
            provider="vendor",
            indexing_technique="high_quality",
            retrieval_model={"search_method": "semantic_search", "top_k": 2},
        )

        with (
            patch("services.dataset_service.DatasetService._has_dataset_same_name") as mock_has_same_name,
            patch("services.dataset_service.DatasetService.check_dataset_permission") as mock_check_perm,
            patch("services.dataset_service.naive_utc_now") as mock_time,
            patch(
                "services.dataset_service.DatasetService._update_pipeline_knowledge_base_node_data"
            ) as mock_update_pipeline,
        ):
            mock_dataset_service_dependencies["get_dataset"].return_value = dataset
            mock_has_same_name.return_value = False
            mock_time.return_value = "2024-01-01T00:00:00"

            user = DatasetServiceTestDataFactory.create_account_mock()

            new_retrieval_config = {
                "search_method": "full_text_search",
                "top_k": 10,
                "score_threshold": 0.7,
            }

            update_data = {
                "indexing_technique": "high_quality",
                "retrieval_model": new_retrieval_config,
            }

            # Act
            result = DatasetService.update_dataset("dataset-123", update_data, user)

            # Assert
            mock_dataset_service_dependencies[
                "db_session"
            ].query.return_value.filter_by.return_value.update.assert_called_once()
            call_args = mock_dataset_service_dependencies[
                "db_session"
            ].query.return_value.filter_by.return_value.update.call_args[0][0]
            assert call_args["retrieval_model"] == new_retrieval_config
            assert result == dataset

    def test_create_dataset_with_retrieval_model_and_reranking(self, mock_dataset_service_dependencies):
        """Test creating dataset with retrieval model and reranking configuration."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetServiceTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "Dataset with Reranking"

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Mock retrieval model with reranking
        retrieval_model = Mock(spec=RetrievalModel)
        retrieval_model.model_dump.return_value = {
            "search_method": "semantic_search",
            "top_k": 3,
            "score_threshold": 0.6,
            "reranking_enable": True,
        }
        reranking_model = Mock()
        reranking_model.reranking_provider_name = "cohere"
        reranking_model.reranking_model_name = "rerank-english-v2.0"
        retrieval_model.reranking_model = reranking_model

        # Mock model manager
        embedding_model = DatasetServiceTestDataFactory.create_embedding_model_mock()
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_default_model_instance.return_value = embedding_model

        with (
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch("services.dataset_service.DatasetService.check_embedding_model_setting") as mock_check_embedding,
            patch("services.dataset_service.DatasetService.check_reranking_model_setting") as mock_check_reranking,
        ):
            mock_model_manager.return_value = mock_model_manager_instance

            mock_db = mock_dataset_service_dependencies["db_session"]
            mock_db.add = Mock()
            mock_db.flush = Mock()
            mock_db.commit = Mock()

            # Act
            result = DatasetService.create_empty_dataset(
                tenant_id=tenant_id,
                name=name,
                description=None,
                indexing_technique="high_quality",
                account=account,
                retrieval_model=retrieval_model,
            )

            # Assert
            assert result.retrieval_model == retrieval_model.model_dump()
            mock_check_reranking.assert_called_once_with(tenant_id, "cohere", "rerank-english-v2.0")
            mock_db.commit.assert_called_once()
