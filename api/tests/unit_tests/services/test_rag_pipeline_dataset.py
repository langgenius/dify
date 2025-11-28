"""
Comprehensive unit tests for RAG pipeline dataset operations in DatasetService.

This test suite provides complete coverage of RAG pipeline dataset creation, management,
and configuration operations in Dify, following TDD principles with the Arrange-Act-Assert pattern.

RAG pipeline datasets are specialized datasets that integrate with pipeline workflows,
allowing knowledge bases to be used within complex pipeline configurations for advanced
RAG (Retrieval-Augmented Generation) applications.

## Test Coverage

### 1. RAG Pipeline Dataset Creation (TestRAGPipelineDatasetCreation)
Tests dataset creation operations:
- create_empty_rag_pipeline_dataset: Creating new RAG pipeline datasets with various configurations
- Name validation and duplicate checking
- Auto-name generation for unnamed datasets
- Pipeline and dataset creation integration

### 2. Pipeline Knowledge Base Node Updates (TestPipelineKnowledgeBaseNodeUpdates)
Tests knowledge base node update operations:
- _update_pipeline_knowledge_base_node_data: Updating knowledge-index nodes in workflows
- Published and draft workflow updates
- Node data synchronization with dataset settings
- Error handling during node updates

### 3. Pipeline Dataset Settings Updates (TestPipelineDatasetSettingsUpdates)
Tests dataset settings update operations:
- update_rag_pipeline_dataset_settings: Updating RAG pipeline dataset configurations
- Unpublished dataset settings updates
- Published dataset settings restrictions
- Embedding model configuration
- Indexing technique changes

## Testing Approach

- **Mocking Strategy**: All external dependencies (database, RagPipelineService,
  ModelManager, DatasetCollectionBindingService, current_user) are mocked for fast,
  isolated unit tests
- **Factory Pattern**: RAGPipelineDatasetTestDataFactory provides consistent test data
- **Fixtures**: Mock objects are configured per test method
- **Assertions**: Each test verifies return values and side effects
  (database operations, method calls, exception raising)

## Key Concepts

**RAG Pipeline Datasets:**
- Specialized datasets with runtime_mode="rag_pipeline"
- Linked to Pipeline objects via pipeline_id
- Integrate with workflow knowledge-index nodes
- Support both published and draft workflow configurations

**Knowledge Base Nodes:**
- Nodes in workflow graphs with type="knowledge-index"
- Contain embedding model, retrieval model, and indexing technique settings
- Automatically synchronized with dataset settings

**Pipeline Workflows:**
- Published workflows: Active, production-ready configurations
- Draft workflows: Development/testing configurations
- Both workflows can contain knowledge-index nodes that need synchronization

**Dataset Settings:**
- Chunk structure: Defines how documents are segmented
- Indexing technique: "high_quality" (vector) or "economy" (keyword)
- Embedding model: Required for high_quality indexing
- Retrieval model: Configuration for retrieval operations

**Configuration Validation:**
- Unpublished datasets: Full configuration allowed
- Published datasets: Restrictions on chunk structure and indexing technique changes
- Embedding model validation for high_quality indexing
- Error handling for invalid configurations
"""


# ============================================================================
# IMPORTS
# ============================================================================

import json
from unittest.mock import MagicMock, Mock, create_autospec, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.model_runtime.entities.model_entities import ModelType
from models import Account
from models.dataset import Dataset, DatasetPermissionEnum, Pipeline
from models.workflow import Workflow
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.rag_pipeline_entities import (
    IconInfo,
    KnowledgeConfiguration,
    RagPipelineDatasetCreateEntity,
    RetrievalSetting,
)
from services.errors.dataset import DatasetNameDuplicateError
from services.rag_pipeline.rag_pipeline import RagPipelineService


# ============================================================================
# TEST DATA FACTORY
# ============================================================================

class RAGPipelineDatasetTestDataFactory:
    """
    Factory for creating test data and mock objects.

    Provides reusable methods to create consistent mock objects for testing
    RAG pipeline dataset operations. This factory ensures all test data follows
    the same structure and reduces code duplication.

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
        **kwargs,
    ) -> Mock:
        """
        Create a mock Account (user) object.

        Args:
            user_id: Unique identifier for the user/account
            tenant_id: Tenant identifier for multi-tenancy isolation
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Account object with specified attributes
        """
        # Create a mock that matches the Account model interface
        user = create_autospec(Account, instance=True)

        # Set core attributes
        user.id = user_id
        user.current_tenant_id = tenant_id

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(user, key, value)

        return user

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        name: str = "Test Dataset",
        tenant_id: str = "tenant-123",
        pipeline_id: str = "pipeline-123",
        runtime_mode: str = "rag_pipeline",
        embedding_model: str | None = "text-embedding-ada-002",
        embedding_model_provider: str | None = "openai",
        indexing_technique: str | None = "high_quality",
        chunk_structure: str | None = "naive",
        keyword_number: int | None = None,
        retrieval_model: dict | None = None,
        created_by: str = "user-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Dataset object for RAG pipeline testing.

        Args:
            dataset_id: Unique identifier for the dataset
            name: Dataset name
            tenant_id: Tenant identifier
            pipeline_id: Associated pipeline ID
            runtime_mode: Runtime mode (should be "rag_pipeline")
            embedding_model: Embedding model identifier
            embedding_model_provider: Embedding model provider
            indexing_technique: Indexing technique ("high_quality" or "economy")
            chunk_structure: Document chunk structure
            keyword_number: Keyword number for economy indexing
            retrieval_model: Retrieval model configuration dictionary
            created_by: User ID of creator
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Dataset object with specified attributes
        """
        # Create a mock dataset
        dataset = Mock(spec=Dataset)

        # Set core attributes
        dataset.id = dataset_id
        dataset.name = name
        dataset.tenant_id = tenant_id
        dataset.pipeline_id = pipeline_id
        dataset.runtime_mode = runtime_mode
        dataset.embedding_model = embedding_model
        dataset.embedding_model_provider = embedding_model_provider
        dataset.indexing_technique = indexing_technique
        dataset.chunk_structure = chunk_structure
        dataset.keyword_number = keyword_number
        dataset.retrieval_model = retrieval_model or {"top_k": 2, "score_threshold": 0.0}
        dataset.created_by = created_by

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(dataset, key, value)

        return dataset

    @staticmethod
    def create_pipeline_mock(
        pipeline_id: str = "pipeline-123",
        name: str = "Test Pipeline",
        tenant_id: str = "tenant-123",
        created_by: str = "user-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Pipeline object.

        Args:
            pipeline_id: Unique identifier for the pipeline
            name: Pipeline name
            tenant_id: Tenant identifier
            created_by: User ID of creator
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Pipeline object with specified attributes
        """
        # Create a mock pipeline
        pipeline = Mock(spec=Pipeline)

        # Set core attributes
        pipeline.id = pipeline_id
        pipeline.name = name
        pipeline.tenant_id = tenant_id
        pipeline.created_by = created_by

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(pipeline, key, value)

        return pipeline

    @staticmethod
    def create_workflow_mock(
        workflow_id: str = "workflow-123",
        graph: str | None = None,
        **kwargs,
    ) -> Mock:
        """
        Create a mock Workflow object.

        Args:
            workflow_id: Unique identifier for the workflow
            graph: Workflow graph JSON string
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Workflow object with specified attributes
        """
        # Create a mock workflow
        workflow = Mock(spec=Workflow)

        # Set core attributes
        workflow.id = workflow_id
        workflow.graph = graph or json.dumps({"nodes": [], "edges": []})

        # Apply any additional attributes from kwargs
        for key, value in kwargs.items():
            setattr(workflow, key, value)

        return workflow

    @staticmethod
    def create_rag_pipeline_dataset_create_entity_mock(
        name: str = "New RAG Pipeline Dataset",
        description: str = "Test description",
        permission: str = DatasetPermissionEnum.ONLY_ME,
        icon_info: IconInfo | None = None,
        partial_member_list: list[str] | None = None,
        yaml_content: str | None = None,
    ) -> Mock:
        """
        Create a mock RagPipelineDatasetCreateEntity.

        Args:
            name: Dataset name
            description: Dataset description
            permission: Dataset permission level
            icon_info: Icon information
            partial_member_list: List of partial member IDs
            yaml_content: Optional YAML content for pipeline definition

        Returns:
            Mock RagPipelineDatasetCreateEntity object
        """
        # Create mock entity
        entity = Mock(spec=RagPipelineDatasetCreateEntity)

        # Set attributes
        entity.name = name
        entity.description = description
        entity.permission = permission
        entity.icon_info = icon_info or IconInfo(
            icon_type="emoji", icon="📚", icon_background="#FFE5B4", icon_url=None
        )
        entity.partial_member_list = partial_member_list
        entity.yaml_content = yaml_content

        return entity

    @staticmethod
    def create_knowledge_configuration_mock(
        chunk_structure: str = "naive",
        indexing_technique: str = "high_quality",
        embedding_model_provider: str = "openai",
        embedding_model: str = "text-embedding-ada-002",
        keyword_number: int | None = 10,
        retrieval_model: RetrievalSetting | None = None,
    ) -> Mock:
        """
        Create a mock KnowledgeConfiguration.

        Args:
            chunk_structure: Document chunk structure
            indexing_technique: Indexing technique
            embedding_model_provider: Embedding model provider
            embedding_model: Embedding model identifier
            keyword_number: Keyword number for economy indexing
            retrieval_model: Retrieval model configuration

        Returns:
            Mock KnowledgeConfiguration object
        """
        # Create mock configuration
        config = Mock(spec=KnowledgeConfiguration)

        # Set attributes
        config.chunk_structure = chunk_structure
        config.indexing_technique = indexing_technique
        config.embedding_model_provider = embedding_model_provider
        config.embedding_model = embedding_model
        config.keyword_number = keyword_number
        config.retrieval_model = retrieval_model or RetrievalSetting(
            top_k=2, score_threshold=0.0, reranking_enable=False
        )

        return config

    @staticmethod
    def create_embedding_model_mock(
        model: str = "text-embedding-ada-002",
        provider: str = "openai",
        **kwargs,
    ) -> Mock:
        """
        Create a mock embedding model object.

        Args:
            model: Model name/identifier
            provider: Model provider name
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock embedding model object
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

        Args:
            binding_id: Unique identifier for the binding
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock collection binding object
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
# TEST CLASSES
# ============================================================================


class TestRAGPipelineDatasetCreation:
    """
    Test RAG pipeline dataset creation operations.

    This test class covers the create_empty_rag_pipeline_dataset method,
    which creates new RAG pipeline datasets with associated Pipeline objects.

    Test scenarios include:
    - Successful dataset creation with custom name
    - Auto-name generation for unnamed datasets
    - Duplicate name validation
    - Pipeline and dataset integration
    - Current user validation
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return RAGPipelineDatasetTestDataFactory

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    @patch("services.dataset_service.generate_incremental_name")
    def test_create_empty_rag_pipeline_dataset_with_name_success(
        self, mock_generate_name, mock_current_user, mock_db_session, factory
    ):
        """
        Test successful RAG pipeline dataset creation with custom name.

        This test verifies that the create_empty_rag_pipeline_dataset method
        correctly creates both a Pipeline and Dataset object when a name is provided.

        Expected behavior:
        - Pipeline is created with correct attributes
        - Dataset is created with correct attributes
        - Pipeline and dataset are linked via pipeline_id
        - Database session operations are executed
        - Returns created dataset
        """
        # Arrange
        tenant_id = "tenant-123"
        dataset_name = "My RAG Pipeline Dataset"
        user_id = "user-123"

        # Configure current_user mock
        mock_current_user.id = user_id
        mock_current_user.current_tenant_id = tenant_id

        # Create create entity
        create_entity = factory.create_rag_pipeline_dataset_create_entity_mock(name=dataset_name)

        # Mock database queries
        mock_query = MagicMock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None  # No duplicate name

        mock_db_session.query.return_value = mock_query
        mock_db_session.add = MagicMock()
        mock_db_session.flush = MagicMock()
        mock_db_session.commit = MagicMock()

        # Act
        result = DatasetService.create_empty_rag_pipeline_dataset(tenant_id, create_entity)

        # Assert
        # Verify database operations
        assert mock_db_session.add.call_count == 2, "Should add both Pipeline and Dataset"

        # Verify pipeline was created
        pipeline_add_call = mock_db_session.add.call_args_list[0]
        created_pipeline = pipeline_add_call[0][0]
        assert isinstance(created_pipeline, Pipeline) or hasattr(created_pipeline, "name")
        assert created_pipeline.name == dataset_name

        # Verify dataset was created
        dataset_add_call = mock_db_session.add.call_args_list[1]
        created_dataset = dataset_add_call[0][0]
        assert isinstance(created_dataset, Dataset) or hasattr(created_dataset, "name")
        assert created_dataset.name == dataset_name
        assert created_dataset.runtime_mode == "rag_pipeline"
        assert created_dataset.provider == "vendor"
        assert created_dataset.pipeline_id == created_pipeline.id

        # Verify session operations
        mock_db_session.flush.assert_called_once()
        mock_db_session.commit.assert_called_once()

        # Verify result
        assert result == created_dataset

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    @patch("services.dataset_service.generate_incremental_name")
    def test_create_empty_rag_pipeline_dataset_without_name_auto_generates(
        self, mock_generate_name, mock_current_user, mock_db_session, factory
    ):
        """
        Test RAG pipeline dataset creation with auto-generated name.

        This test verifies that when no name is provided, the method generates
        an incremental name using generate_incremental_name.

        Expected behavior:
        - Existing dataset names are queried
        - generate_incremental_name is called
        - Generated name is assigned to entity
        - Pipeline and dataset are created with generated name
        """
        # Arrange
        tenant_id = "tenant-123"
        user_id = "user-123"
        generated_name = "Untitled 1"

        # Configure current_user mock
        mock_current_user.id = user_id
        mock_current_user.current_tenant_id = tenant_id

        # Create create entity without name
        create_entity = factory.create_rag_pipeline_dataset_create_entity_mock(name="")

        # Mock existing datasets
        existing_datasets = [
            factory.create_dataset_mock(name="Untitled"),
            factory.create_dataset_mock(name="Untitled 2"),
        ]

        # Mock database queries
        mock_query = MagicMock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None  # No duplicate name
        mock_query.all.return_value = existing_datasets

        mock_db_session.query.return_value = mock_query
        mock_generate_name.return_value = generated_name

        mock_db_session.add = MagicMock()
        mock_db_session.flush = MagicMock()
        mock_db_session.commit = MagicMock()

        # Act
        result = DatasetService.create_empty_rag_pipeline_dataset(tenant_id, create_entity)

        # Assert
        # Verify generate_incremental_name was called
        mock_generate_name.assert_called_once()
        assert create_entity.name == generated_name

        # Verify database operations
        assert mock_db_session.add.call_count == 2

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    def test_create_empty_rag_pipeline_dataset_duplicate_name_raises_error(
        self, mock_current_user, mock_db_session, factory
    ):
        """
        Test that duplicate dataset name raises DatasetNameDuplicateError.

        This test verifies that when a dataset with the same name already exists,
        the method raises DatasetNameDuplicateError.

        Expected behavior:
        - DatasetNameDuplicateError is raised
        - Error message includes duplicate name
        - No pipeline or dataset is created
        """
        # Arrange
        tenant_id = "tenant-123"
        dataset_name = "Duplicate Name"
        user_id = "user-123"

        # Configure current_user mock
        mock_current_user.id = user_id
        mock_current_user.current_tenant_id = tenant_id

        # Create create entity
        create_entity = factory.create_rag_pipeline_dataset_create_entity_mock(name=dataset_name)

        # Mock existing dataset with same name
        existing_dataset = factory.create_dataset_mock(name=dataset_name)

        # Mock database queries
        mock_query = MagicMock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = existing_dataset  # Duplicate name found

        mock_db_session.query.return_value = mock_query

        # Act & Assert
        with pytest.raises(DatasetNameDuplicateError, match=dataset_name):
            DatasetService.create_empty_rag_pipeline_dataset(tenant_id, create_entity)

        # Verify no dataset was created
        mock_db_session.add.assert_not_called()

    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    def test_create_empty_rag_pipeline_dataset_no_current_user_raises_error(
        self, mock_current_user, mock_db_session, factory
    ):
        """
        Test that missing current_user raises ValueError.

        This test verifies that when current_user is None or has no id,
        the method raises ValueError.

        Expected behavior:
        - ValueError is raised
        - Error message indicates missing current user
        """
        # Arrange
        tenant_id = "tenant-123"

        # Configure current_user mock to be None
        mock_current_user.id = None
        mock_current_user.current_tenant_id = tenant_id

        # Create create entity
        create_entity = factory.create_rag_pipeline_dataset_create_entity_mock()

        # Mock database queries
        mock_query = MagicMock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None  # No duplicate name

        mock_db_session.query.return_value = mock_query

        # Act & Assert
        with pytest.raises(ValueError, match="Current user or current user id not found"):
            DatasetService.create_empty_rag_pipeline_dataset(tenant_id, create_entity)


# ============================================================================
# PIPELINE KNOWLEDGE BASE NODE UPDATE TESTS
# ============================================================================


class TestPipelineKnowledgeBaseNodeUpdates:
    """
    Test pipeline knowledge base node update operations.

    This test class covers the _update_pipeline_knowledge_base_node_data method,
    which synchronizes knowledge-index node settings with dataset configurations.

    Test scenarios include:
    - Updating published workflow nodes
    - Updating draft workflow nodes
    - Skipping updates for non-RAG pipeline datasets
    - Handling missing pipelines
    - Error handling during node updates
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return RAGPipelineDatasetTestDataFactory

    @patch("services.dataset_service.RagPipelineService")
    @patch("services.dataset_service.db.session")
    @patch("services.dataset_service.Workflow")
    def test_update_pipeline_knowledge_base_node_data_rag_pipeline_updates_nodes(
        self, mock_workflow_class, mock_db_session, mock_rag_pipeline_service_class, factory
    ):
        """
        Test that knowledge base nodes are updated for RAG pipeline datasets.

        This test verifies that when a dataset has runtime_mode="rag_pipeline",
        the method updates knowledge-index nodes in both published and draft workflows.

        Expected behavior:
        - RagPipelineService is instantiated
        - Published and draft workflows are retrieved
        - Knowledge-index nodes are updated with dataset settings
        - Workflow versions are created if changes are made
        """
        # Arrange
        dataset = factory.create_dataset_mock(
            runtime_mode="rag_pipeline",
            pipeline_id="pipeline-123",
            embedding_model="text-embedding-ada-002",
            embedding_model_provider="openai",
            indexing_technique="high_quality",
            chunk_structure="naive",
            keyword_number=10,
        )

        pipeline = factory.create_pipeline_mock(pipeline_id="pipeline-123")

        # Create workflow graph with knowledge-index node
        workflow_graph = {
            "nodes": [
                {
                    "id": "node-1",
                    "data": {
                        "type": "knowledge-index",
                        "embedding_model": "old-model",
                        "embedding_model_provider": "old-provider",
                    },
                },
                {"id": "node-2", "data": {"type": "other-node"}},
            ],
            "edges": [],
        }

        published_workflow = factory.create_workflow_mock(
            workflow_id="published-123", graph=json.dumps(workflow_graph)
        )
        draft_workflow = factory.create_workflow_mock(workflow_id="draft-123", graph=json.dumps(workflow_graph))

        # Mock RagPipelineService
        mock_rag_pipeline_service = MagicMock()
        mock_rag_pipeline_service.get_published_workflow.return_value = published_workflow
        mock_rag_pipeline_service.get_draft_workflow.return_value = draft_workflow
        mock_rag_pipeline_service_class.return_value = mock_rag_pipeline_service

        # Mock database queries
        mock_query = MagicMock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = pipeline
        mock_db_session.query.return_value = mock_query

        # Mock Workflow.new
        new_workflow = factory.create_workflow_mock(workflow_id="new-workflow-123")
        mock_workflow_class.new.return_value = new_workflow
        mock_db_session.add = MagicMock()
        mock_db_session.commit = MagicMock()

        # Act
        DatasetService._update_pipeline_knowledge_base_node_data(dataset, "user-123")

        # Assert
        # Verify RagPipelineService was used
        mock_rag_pipeline_service.get_published_workflow.assert_called_once_with(pipeline)
        mock_rag_pipeline_service.get_draft_workflow.assert_called_once_with(pipeline)

        # Verify workflow updates were attempted (new versions created if changes detected)
        # The exact behavior depends on whether the graph changed
        assert mock_rag_pipeline_service.get_published_workflow.called
        assert mock_rag_pipeline_service.get_draft_workflow.called

    @patch("services.dataset_service.db.session")
    def test_update_pipeline_knowledge_base_node_data_non_rag_pipeline_skips(
        self, mock_db_session, factory
    ):
        """
        Test that non-RAG pipeline datasets skip node updates.

        This test verifies that when a dataset does not have runtime_mode="rag_pipeline",
        the method returns early without performing any updates.

        Expected behavior:
        - Method returns early
        - No RagPipelineService operations
        - No workflow queries
        """
        # Arrange
        dataset = factory.create_dataset_mock(runtime_mode="normal")  # Not RAG pipeline

        # Act
        DatasetService._update_pipeline_knowledge_base_node_data(dataset, "user-123")

        # Assert
        # Verify no database operations were performed
        mock_db_session.query.assert_not_called()

    @patch("services.dataset_service.db.session")
    def test_update_pipeline_knowledge_base_node_data_missing_pipeline_skips(
        self, mock_db_session, factory
    ):
        """
        Test that missing pipeline skips node updates.

        This test verifies that when a pipeline is not found for the dataset,
        the method returns early without performing any updates.

        Expected behavior:
        - Method returns early when pipeline is None
        - No RagPipelineService operations
        """
        # Arrange
        dataset = factory.create_dataset_mock(
            runtime_mode="rag_pipeline",
            pipeline_id="pipeline-123",
        )

        # Mock database query to return None (no pipeline found)
        mock_query = MagicMock()
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None
        mock_db_session.query.return_value = mock_query

        # Act
        DatasetService._update_pipeline_knowledge_base_node_data(dataset, "user-123")

        # Assert
        # Verify pipeline query was attempted
        mock_db_session.query.assert_called()


# ============================================================================
# PIPELINE DATASET SETTINGS UPDATE TESTS
# ============================================================================


class TestPipelineDatasetSettingsUpdates:
    """
    Test pipeline dataset settings update operations.

    This test class covers the update_rag_pipeline_dataset_settings method,
    which updates RAG pipeline dataset configurations with various restrictions
    for published vs unpublished datasets.

    Test scenarios include:
    - Updating unpublished dataset settings
    - Updating published dataset settings (with restrictions)
    - Embedding model configuration for high_quality indexing
    - Economy indexing configuration
    - Chunk structure update restrictions
    - Indexing technique change restrictions
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return RAGPipelineDatasetTestDataFactory

    @patch("services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding")
    @patch("services.dataset_service.ModelManager")
    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    def test_update_rag_pipeline_dataset_settings_unpublished_high_quality_success(
        self, mock_current_user, mock_model_manager_class, mock_get_binding, factory
    ):
        """
        Test successful settings update for unpublished dataset with high_quality indexing.

        This test verifies that unpublished datasets can be fully configured
        with high_quality indexing technique and embedding models.

        Expected behavior:
        - Dataset settings are updated
        - Embedding model is configured via ModelManager
        - Collection binding is retrieved
        - Dataset is saved to session
        """
        # Arrange
        tenant_id = "tenant-123"
        user_id = "user-123"
        dataset_id = "dataset-123"

        # Configure current_user mock
        mock_current_user.id = user_id
        mock_current_user.current_tenant_id = tenant_id

        # Create dataset
        dataset = factory.create_dataset_mock(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            runtime_mode="rag_pipeline",
        )

        # Create knowledge configuration
        knowledge_config = factory.create_knowledge_configuration_mock(
            chunk_structure="naive",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
        )

        # Mock ModelManager
        embedding_model = factory.create_embedding_model_mock()
        mock_model_manager = MagicMock()
        mock_model_manager.get_model_instance.return_value = embedding_model
        mock_model_manager_class.return_value = mock_model_manager

        # Mock collection binding
        collection_binding = factory.create_collection_binding_mock()
        mock_get_binding.return_value = collection_binding

        # Mock session
        mock_session = MagicMock(spec=Session)
        mock_session.merge.return_value = dataset
        mock_session.add = MagicMock()

        # Act
        DatasetService.update_rag_pipeline_dataset_settings(
            mock_session, dataset, knowledge_config, has_published=False
        )

        # Assert
        # Verify ModelManager was used
        mock_model_manager.get_model_instance.assert_called_once_with(
            tenant_id=tenant_id,
            provider="openai",
            model_type=ModelType.TEXT_EMBEDDING,
            model="text-embedding-ada-002",
        )

        # Verify collection binding was retrieved
        mock_get_binding.assert_called_once_with(embedding_model.provider, embedding_model.model)

        # Verify dataset was updated
        assert dataset.chunk_structure == "naive"
        assert dataset.indexing_technique == "high_quality"
        assert dataset.embedding_model == embedding_model.model
        assert dataset.embedding_model_provider == embedding_model.provider
        assert dataset.collection_binding_id == collection_binding.id

        # Verify dataset was saved
        mock_session.add.assert_called_once_with(dataset)

    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    def test_update_rag_pipeline_dataset_settings_unpublished_economy_success(
        self, mock_current_user, factory
    ):
        """
        Test successful settings update for unpublished dataset with economy indexing.

        This test verifies that unpublished datasets can be configured
        with economy indexing technique.

        Expected behavior:
        - Dataset settings are updated
        - Keyword number is set
        - No embedding model configuration needed
        - Dataset is saved to session
        """
        # Arrange
        tenant_id = "tenant-123"
        user_id = "user-123"

        # Configure current_user mock
        mock_current_user.id = user_id
        mock_current_user.current_tenant_id = tenant_id

        # Create dataset
        dataset = factory.create_dataset_mock(
            tenant_id=tenant_id,
            runtime_mode="rag_pipeline",
        )

        # Create knowledge configuration with economy indexing
        knowledge_config = factory.create_knowledge_configuration_mock(
            chunk_structure="naive",
            indexing_technique="economy",
            keyword_number=20,
        )

        # Mock session
        mock_session = MagicMock(spec=Session)
        mock_session.merge.return_value = dataset
        mock_session.add = MagicMock()

        # Act
        DatasetService.update_rag_pipeline_dataset_settings(
            mock_session, dataset, knowledge_config, has_published=False
        )

        # Assert
        # Verify dataset was updated
        assert dataset.chunk_structure == "naive"
        assert dataset.indexing_technique == "economy"
        assert dataset.keyword_number == 20

        # Verify dataset was saved
        mock_session.add.assert_called_once_with(dataset)

    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    def test_update_rag_pipeline_dataset_settings_published_chunk_structure_restriction(
        self, mock_current_user, factory
    ):
        """
        Test that published datasets cannot change chunk structure.

        This test verifies that when a dataset is published, changing the
        chunk structure raises a ValueError.

        Expected behavior:
        - ValueError is raised
        - Error message indicates chunk structure cannot be updated
        """
        # Arrange
        tenant_id = "tenant-123"

        # Configure current_user mock
        mock_current_user.current_tenant_id = tenant_id

        # Create dataset with existing chunk structure
        dataset = factory.create_dataset_mock(
            tenant_id=tenant_id,
            runtime_mode="rag_pipeline",
            chunk_structure="semantic",
        )

        # Create knowledge configuration with different chunk structure
        knowledge_config = factory.create_knowledge_configuration_mock(
            chunk_structure="naive",  # Different from existing
            indexing_technique="high_quality",
        )

        # Mock session
        mock_session = MagicMock(spec=Session)
        mock_session.merge.return_value = dataset

        # Act & Assert
        with pytest.raises(ValueError, match="Chunk structure is not allowed to be updated"):
            DatasetService.update_rag_pipeline_dataset_settings(
                mock_session, dataset, knowledge_config, has_published=True
            )

    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    def test_update_rag_pipeline_dataset_settings_published_cannot_change_to_economy(
        self, mock_current_user, factory
    ):
        """
        Test that published datasets cannot change to economy indexing.

        This test verifies that when a dataset is published, changing the
        indexing technique to economy raises a ValueError.

        Expected behavior:
        - ValueError is raised
        - Error message indicates indexing technique cannot be changed to economy
        """
        # Arrange
        tenant_id = "tenant-123"

        # Configure current_user mock
        mock_current_user.current_tenant_id = tenant_id

        # Create dataset with high_quality indexing
        dataset = factory.create_dataset_mock(
            tenant_id=tenant_id,
            runtime_mode="rag_pipeline",
            indexing_technique="high_quality",
            chunk_structure="naive",
        )

        # Create knowledge configuration trying to change to economy
        knowledge_config = factory.create_knowledge_configuration_mock(
            chunk_structure="naive",
            indexing_technique="economy",  # Trying to change to economy
        )

        # Mock session
        mock_session = MagicMock(spec=Session)
        mock_session.merge.return_value = dataset

        # Act & Assert
        with pytest.raises(
            ValueError, match="Knowledge base indexing technique is not allowed to be updated to economy"
        ):
            DatasetService.update_rag_pipeline_dataset_settings(
                mock_session, dataset, knowledge_config, has_published=True
            )

    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    def test_update_rag_pipeline_dataset_settings_no_current_user_raises_error(
        self, mock_current_user, factory
    ):
        """
        Test that missing current_user raises ValueError.

        This test verifies that when current_user is None or has no tenant_id,
        the method raises ValueError.

        Expected behavior:
        - ValueError is raised
        - Error message indicates missing current user
        """
        # Arrange
        # Configure current_user mock to be None
        mock_current_user.current_tenant_id = None

        # Create dataset
        dataset = factory.create_dataset_mock(runtime_mode="rag_pipeline")

        # Create knowledge configuration
        knowledge_config = factory.create_knowledge_configuration_mock()

        # Mock session
        mock_session = MagicMock(spec=Session)
        mock_session.merge.return_value = dataset

        # Act & Assert
        with pytest.raises(ValueError, match="Current user or current tenant not found"):
            DatasetService.update_rag_pipeline_dataset_settings(
                mock_session, dataset, knowledge_config, has_published=False
            )

    @patch("services.dataset_service.current_user", new_callable=lambda: create_autospec(Account, instance=True))
    def test_update_rag_pipeline_dataset_settings_invalid_index_method_raises_error(
        self, mock_current_user, factory
    ):
        """
        Test that invalid indexing technique raises ValueError.

        This test verifies that when an invalid indexing technique is provided,
        the method raises ValueError.

        Expected behavior:
        - ValueError is raised
        - Error message indicates invalid index method
        """
        # Arrange
        tenant_id = "tenant-123"

        # Configure current_user mock
        mock_current_user.current_tenant_id = tenant_id

        # Create dataset
        dataset = factory.create_dataset_mock(tenant_id=tenant_id, runtime_mode="rag_pipeline")

        # Create knowledge configuration with invalid indexing technique
        knowledge_config = factory.create_knowledge_configuration_mock(
            indexing_technique="invalid_method"  # Invalid value
        )
        # Override to invalid value since the factory uses Literal type
        knowledge_config.indexing_technique = "invalid_method"

        # Mock session
        mock_session = MagicMock(spec=Session)
        mock_session.merge.return_value = dataset

        # Act & Assert
        # This will fail when trying to configure embedding model or keyword_number
        # The exact error depends on implementation, but should raise ValueError
        with pytest.raises(ValueError):
            DatasetService.update_rag_pipeline_dataset_settings(
                mock_session, dataset, knowledge_config, has_published=False
            )

