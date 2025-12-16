"""
Comprehensive unit tests for DatasetService creation methods.

This test suite covers:
- create_empty_dataset for internal datasets
- create_empty_dataset for external datasets
- create_empty_rag_pipeline_dataset
- Error conditions and edge cases
"""

from unittest.mock import Mock, create_autospec, patch
from uuid import uuid4

import pytest

from core.model_runtime.entities.model_entities import ModelType
from models.account import Account
from models.dataset import Dataset, Pipeline
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.knowledge_entities import RetrievalModel
from services.entities.knowledge_entities.rag_pipeline_entities import (
    IconInfo,
    RagPipelineDatasetCreateEntity,
)
from services.errors.dataset import DatasetNameDuplicateError


class DatasetCreateTestDataFactory:
    """Factory class for creating test data and mock objects for dataset creation tests."""

    @staticmethod
    def create_account_mock(
        account_id: str = "account-123",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """Create a mock account."""
        account = create_autospec(Account, instance=True)
        account.id = account_id
        account.current_tenant_id = tenant_id
        for key, value in kwargs.items():
            setattr(account, key, value)
        return account

    @staticmethod
    def create_embedding_model_mock(model: str = "text-embedding-ada-002", provider: str = "openai") -> Mock:
        """Create a mock embedding model."""
        embedding_model = Mock()
        embedding_model.model = model
        embedding_model.provider = provider
        return embedding_model

    @staticmethod
    def create_retrieval_model_mock() -> Mock:
        """Create a mock retrieval model."""
        retrieval_model = Mock(spec=RetrievalModel)
        retrieval_model.model_dump.return_value = {
            "search_method": "semantic_search",
            "top_k": 2,
            "score_threshold": 0.0,
        }
        retrieval_model.reranking_model = None
        return retrieval_model

    @staticmethod
    def create_external_knowledge_api_mock(api_id: str = "api-123", **kwargs) -> Mock:
        """Create a mock external knowledge API."""
        api = Mock()
        api.id = api_id
        for key, value in kwargs.items():
            setattr(api, key, value)
        return api

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        name: str = "Test Dataset",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """Create a mock dataset."""
        dataset = create_autospec(Dataset, instance=True)
        dataset.id = dataset_id
        dataset.name = name
        dataset.tenant_id = tenant_id
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_pipeline_mock(
        pipeline_id: str = "pipeline-123",
        name: str = "Test Pipeline",
        **kwargs,
    ) -> Mock:
        """Create a mock pipeline."""
        pipeline = Mock(spec=Pipeline)
        pipeline.id = pipeline_id
        pipeline.name = name
        for key, value in kwargs.items():
            setattr(pipeline, key, value)
        return pipeline


class TestDatasetServiceCreateEmptyDataset:
    """
    Comprehensive unit tests for DatasetService.create_empty_dataset method.

    This test suite covers:
    - Internal dataset creation (vendor provider)
    - External dataset creation
    - High quality indexing technique with embedding models
    - Economy indexing technique
    - Retrieval model configuration
    - Error conditions (duplicate names, missing external knowledge IDs)
    """

    @pytest.fixture
    def mock_dataset_service_dependencies(self):
        """Common mock setup for dataset service dependencies."""
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

    # ==================== Internal Dataset Creation Tests ====================

    def test_create_internal_dataset_basic_success(self, mock_dataset_service_dependencies):
        """Test successful creation of basic internal dataset."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetCreateTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "Test Dataset"
        description = "Test description"

        # Mock database query to return None (no duplicate name)
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Mock database session operations
        mock_db = mock_dataset_service_dependencies["db_session"]
        mock_db.add = Mock()
        mock_db.flush = Mock()
        mock_db.commit = Mock()

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
        account = DatasetCreateTestDataFactory.create_account_mock(tenant_id=tenant_id)
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

    def test_create_internal_dataset_with_high_quality_indexing_default_embedding(
        self, mock_dataset_service_dependencies
    ):
        """Test creation with high_quality indexing using default embedding model."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetCreateTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "High Quality Dataset"

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Mock model manager
        embedding_model = DatasetCreateTestDataFactory.create_embedding_model_mock()
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

    def test_create_internal_dataset_with_high_quality_indexing_custom_embedding(
        self, mock_dataset_service_dependencies
    ):
        """Test creation with high_quality indexing using custom embedding model."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetCreateTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "Custom Embedding Dataset"
        embedding_provider = "openai"
        embedding_model_name = "text-embedding-3-small"

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Mock model manager
        embedding_model = DatasetCreateTestDataFactory.create_embedding_model_mock(
            model=embedding_model_name, provider=embedding_provider
        )
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_model_instance.return_value = embedding_model
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
            embedding_model_provider=embedding_provider,
            embedding_model_name=embedding_model_name,
        )

        # Assert
        assert result.indexing_technique == "high_quality"
        assert result.embedding_model_provider == embedding_provider
        assert result.embedding_model == embedding_model_name
        mock_dataset_service_dependencies["check_embedding"].assert_called_once_with(
            tenant_id, embedding_provider, embedding_model_name
        )
        mock_model_manager_instance.get_model_instance.assert_called_once_with(
            tenant_id=tenant_id,
            provider=embedding_provider,
            model_type=ModelType.TEXT_EMBEDDING,
            model=embedding_model_name,
        )
        mock_db.commit.assert_called_once()

    def test_create_internal_dataset_with_retrieval_model(self, mock_dataset_service_dependencies):
        """Test creation with retrieval model configuration."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetCreateTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "Retrieval Model Dataset"

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Mock retrieval model
        retrieval_model = DatasetCreateTestDataFactory.create_retrieval_model_mock()
        retrieval_model_dict = {"search_method": "semantic_search", "top_k": 2, "score_threshold": 0.0}

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
            retrieval_model=retrieval_model,
        )

        # Assert
        assert result.retrieval_model == retrieval_model_dict
        retrieval_model.model_dump.assert_called_once()
        mock_db.commit.assert_called_once()

    def test_create_internal_dataset_with_retrieval_model_reranking(self, mock_dataset_service_dependencies):
        """Test creation with retrieval model that includes reranking."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetCreateTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "Reranking Dataset"

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Mock model manager
        embedding_model = DatasetCreateTestDataFactory.create_embedding_model_mock()
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_default_model_instance.return_value = embedding_model
        mock_dataset_service_dependencies["model_manager"].return_value = mock_model_manager_instance

        # Mock retrieval model with reranking
        reranking_model = Mock()
        reranking_model.reranking_provider_name = "cohere"
        reranking_model.reranking_model_name = "rerank-english-v3.0"

        retrieval_model = DatasetCreateTestDataFactory.create_retrieval_model_mock()
        retrieval_model.reranking_model = reranking_model

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
        mock_dataset_service_dependencies["check_reranking"].assert_called_once_with(
            tenant_id, "cohere", "rerank-english-v3.0"
        )
        mock_db.commit.assert_called_once()

    def test_create_internal_dataset_with_custom_permission(self, mock_dataset_service_dependencies):
        """Test creation with custom permission setting."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetCreateTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "Custom Permission Dataset"

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
            indexing_technique=None,
            account=account,
            permission="all_team_members",
        )

        # Assert
        assert result.permission == "all_team_members"
        mock_db.commit.assert_called_once()

    # ==================== External Dataset Creation Tests ====================

    def test_create_external_dataset_success(self, mock_dataset_service_dependencies):
        """Test successful creation of external dataset."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetCreateTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "External Dataset"
        external_api_id = "external-api-123"
        external_knowledge_id = "external-knowledge-456"

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Mock external knowledge API
        external_api = DatasetCreateTestDataFactory.create_external_knowledge_api_mock(api_id=external_api_id)
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
            external_knowledge_api_id=external_api_id,
            external_knowledge_id=external_knowledge_id,
        )

        # Assert
        assert result.provider == "external"
        assert mock_db.add.call_count == 2  # Dataset + ExternalKnowledgeBindings
        mock_dataset_service_dependencies["external_service"].get_external_knowledge_api.assert_called_once_with(
            external_api_id
        )
        mock_db.commit.assert_called_once()

    def test_create_external_dataset_missing_api_id_error(self, mock_dataset_service_dependencies):
        """Test error when external knowledge API is not found."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetCreateTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "External Dataset"
        external_api_id = "non-existent-api"

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Mock external knowledge API not found
        mock_dataset_service_dependencies["external_service"].get_external_knowledge_api.return_value = None

        mock_db = mock_dataset_service_dependencies["db_session"]
        mock_db.add = Mock()
        mock_db.flush = Mock()

        # Act & Assert
        with pytest.raises(ValueError, match="External API template not found"):
            DatasetService.create_empty_dataset(
                tenant_id=tenant_id,
                name=name,
                description=None,
                indexing_technique=None,
                account=account,
                provider="external",
                external_knowledge_api_id=external_api_id,
                external_knowledge_id="knowledge-123",
            )

    def test_create_external_dataset_missing_knowledge_id_error(self, mock_dataset_service_dependencies):
        """Test error when external knowledge ID is missing."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetCreateTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "External Dataset"
        external_api_id = "external-api-123"

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Mock external knowledge API
        external_api = DatasetCreateTestDataFactory.create_external_knowledge_api_mock(api_id=external_api_id)
        mock_dataset_service_dependencies["external_service"].get_external_knowledge_api.return_value = external_api

        mock_db = mock_dataset_service_dependencies["db_session"]
        mock_db.add = Mock()
        mock_db.flush = Mock()

        # Act & Assert
        with pytest.raises(ValueError, match="external_knowledge_id is required"):
            DatasetService.create_empty_dataset(
                tenant_id=tenant_id,
                name=name,
                description=None,
                indexing_technique=None,
                account=account,
                provider="external",
                external_knowledge_api_id=external_api_id,
                external_knowledge_id=None,
            )

    # ==================== Error Handling Tests ====================

    def test_create_dataset_duplicate_name_error(self, mock_dataset_service_dependencies):
        """Test error when dataset name already exists."""
        # Arrange
        tenant_id = str(uuid4())
        account = DatasetCreateTestDataFactory.create_account_mock(tenant_id=tenant_id)
        name = "Duplicate Dataset"

        # Mock database query to return existing dataset
        existing_dataset = DatasetCreateTestDataFactory.create_dataset_mock(name=name)
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = existing_dataset
        mock_dataset_service_dependencies["db_session"].query.return_value = mock_query

        # Act & Assert
        with pytest.raises(DatasetNameDuplicateError, match=f"Dataset with name {name} already exists"):
            DatasetService.create_empty_dataset(
                tenant_id=tenant_id,
                name=name,
                description=None,
                indexing_technique=None,
                account=account,
            )


class TestDatasetServiceCreateEmptyRagPipelineDataset:
    """
    Comprehensive unit tests for DatasetService.create_empty_rag_pipeline_dataset method.

    This test suite covers:
    - RAG pipeline dataset creation with provided name
    - RAG pipeline dataset creation with auto-generated name
    - Pipeline creation
    - Error conditions (duplicate names, missing current user)
    """

    @pytest.fixture
    def mock_rag_pipeline_dependencies(self):
        """Common mock setup for RAG pipeline dataset creation."""
        with (
            patch("services.dataset_service.db.session") as mock_db,
            patch("services.dataset_service.current_user") as mock_current_user,
            patch("services.dataset_service.generate_incremental_name") as mock_generate_name,
        ):
            # Configure mock_current_user to behave like a Flask-Login proxy
            # Default: no user (falsy)
            mock_current_user.id = None
            yield {
                "db_session": mock_db,
                "current_user_mock": mock_current_user,
                "generate_name": mock_generate_name,
            }

    def test_create_rag_pipeline_dataset_with_name_success(self, mock_rag_pipeline_dependencies):
        """Test successful creation of RAG pipeline dataset with provided name."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        name = "RAG Pipeline Dataset"
        description = "RAG Pipeline Description"

        # Mock current user - set up the mock to have id attribute accessible directly
        mock_rag_pipeline_dependencies["current_user_mock"].id = user_id

        # Mock database query (no duplicate name)
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_rag_pipeline_dependencies["db_session"].query.return_value = mock_query

        # Mock database operations
        mock_db = mock_rag_pipeline_dependencies["db_session"]
        mock_db.add = Mock()
        mock_db.flush = Mock()
        mock_db.commit = Mock()

        # Create entity
        icon_info = IconInfo(icon="📙", icon_background="#FFF4ED", icon_type="emoji")
        entity = RagPipelineDatasetCreateEntity(
            name=name,
            description=description,
            icon_info=icon_info,
            permission="only_me",
        )

        # Act
        result = DatasetService.create_empty_rag_pipeline_dataset(
            tenant_id=tenant_id, rag_pipeline_dataset_create_entity=entity
        )

        # Assert
        assert result is not None
        assert result.name == name
        assert result.description == description
        assert result.tenant_id == tenant_id
        assert result.created_by == user_id
        assert result.provider == "vendor"
        assert result.runtime_mode == "rag_pipeline"
        assert result.permission == "only_me"
        assert mock_db.add.call_count == 2  # Pipeline + Dataset
        mock_db.commit.assert_called_once()

    def test_create_rag_pipeline_dataset_with_auto_generated_name(self, mock_rag_pipeline_dependencies):
        """Test creation of RAG pipeline dataset with auto-generated name."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        auto_name = "Untitled 1"

        # Mock current user - set up the mock to have id attribute accessible directly
        mock_rag_pipeline_dependencies["current_user_mock"].id = user_id

        # Mock database query (empty name, need to generate)
        mock_query = Mock()
        mock_query.filter_by.return_value.all.return_value = []
        mock_rag_pipeline_dependencies["db_session"].query.return_value = mock_query

        # Mock name generation
        mock_rag_pipeline_dependencies["generate_name"].return_value = auto_name

        # Mock database operations
        mock_db = mock_rag_pipeline_dependencies["db_session"]
        mock_db.add = Mock()
        mock_db.flush = Mock()
        mock_db.commit = Mock()

        # Create entity with empty name
        icon_info = IconInfo(icon="📙", icon_background="#FFF4ED", icon_type="emoji")
        entity = RagPipelineDatasetCreateEntity(
            name="",
            description="",
            icon_info=icon_info,
            permission="only_me",
        )

        # Act
        result = DatasetService.create_empty_rag_pipeline_dataset(
            tenant_id=tenant_id, rag_pipeline_dataset_create_entity=entity
        )

        # Assert
        assert result.name == auto_name
        mock_rag_pipeline_dependencies["generate_name"].assert_called_once()
        mock_db.commit.assert_called_once()

    def test_create_rag_pipeline_dataset_duplicate_name_error(self, mock_rag_pipeline_dependencies):
        """Test error when RAG pipeline dataset name already exists."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        name = "Duplicate RAG Dataset"

        # Mock current user - set up the mock to have id attribute accessible directly
        mock_rag_pipeline_dependencies["current_user_mock"].id = user_id

        # Mock database query to return existing dataset
        existing_dataset = DatasetCreateTestDataFactory.create_dataset_mock(name=name)
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = existing_dataset
        mock_rag_pipeline_dependencies["db_session"].query.return_value = mock_query

        # Create entity
        icon_info = IconInfo(icon="📙", icon_background="#FFF4ED", icon_type="emoji")
        entity = RagPipelineDatasetCreateEntity(
            name=name,
            description="",
            icon_info=icon_info,
            permission="only_me",
        )

        # Act & Assert
        with pytest.raises(DatasetNameDuplicateError, match=f"Dataset with name {name} already exists"):
            DatasetService.create_empty_rag_pipeline_dataset(
                tenant_id=tenant_id, rag_pipeline_dataset_create_entity=entity
            )

    def test_create_rag_pipeline_dataset_missing_current_user_error(self, mock_rag_pipeline_dependencies):
        """Test error when current user is not available."""
        # Arrange
        tenant_id = str(uuid4())

        # Mock current user as None - set id to None so the check fails
        mock_rag_pipeline_dependencies["current_user_mock"].id = None

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_rag_pipeline_dependencies["db_session"].query.return_value = mock_query

        # Create entity
        icon_info = IconInfo(icon="📙", icon_background="#FFF4ED", icon_type="emoji")
        entity = RagPipelineDatasetCreateEntity(
            name="Test Dataset",
            description="",
            icon_info=icon_info,
            permission="only_me",
        )

        # Act & Assert
        with pytest.raises(ValueError, match="Current user or current user id not found"):
            DatasetService.create_empty_rag_pipeline_dataset(
                tenant_id=tenant_id, rag_pipeline_dataset_create_entity=entity
            )

    def test_create_rag_pipeline_dataset_with_custom_permission(self, mock_rag_pipeline_dependencies):
        """Test creation with custom permission setting."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        name = "Custom Permission RAG Dataset"

        # Mock current user - set up the mock to have id attribute accessible directly
        mock_rag_pipeline_dependencies["current_user_mock"].id = user_id

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_rag_pipeline_dependencies["db_session"].query.return_value = mock_query

        # Mock database operations
        mock_db = mock_rag_pipeline_dependencies["db_session"]
        mock_db.add = Mock()
        mock_db.flush = Mock()
        mock_db.commit = Mock()

        # Create entity
        icon_info = IconInfo(icon="📙", icon_background="#FFF4ED", icon_type="emoji")
        entity = RagPipelineDatasetCreateEntity(
            name=name,
            description="",
            icon_info=icon_info,
            permission="all_team",
        )

        # Act
        result = DatasetService.create_empty_rag_pipeline_dataset(
            tenant_id=tenant_id, rag_pipeline_dataset_create_entity=entity
        )

        # Assert
        assert result.permission == "all_team"
        mock_db.commit.assert_called_once()

    def test_create_rag_pipeline_dataset_with_icon_info(self, mock_rag_pipeline_dependencies):
        """Test creation with icon info configuration."""
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        name = "Icon Info RAG Dataset"

        # Mock current user - set up the mock to have id attribute accessible directly
        mock_rag_pipeline_dependencies["current_user_mock"].id = user_id

        # Mock database query
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_rag_pipeline_dependencies["db_session"].query.return_value = mock_query

        # Mock database operations
        mock_db = mock_rag_pipeline_dependencies["db_session"]
        mock_db.add = Mock()
        mock_db.flush = Mock()
        mock_db.commit = Mock()

        # Create entity with icon info
        icon_info = IconInfo(
            icon="📚",
            icon_background="#E8F5E9",
            icon_type="emoji",
            icon_url="https://example.com/icon.png",
        )
        entity = RagPipelineDatasetCreateEntity(
            name=name,
            description="",
            icon_info=icon_info,
            permission="only_me",
        )

        # Act
        result = DatasetService.create_empty_rag_pipeline_dataset(
            tenant_id=tenant_id, rag_pipeline_dataset_create_entity=entity
        )

        # Assert
        assert result.icon_info == icon_info.model_dump()
        mock_db.commit.assert_called_once()
