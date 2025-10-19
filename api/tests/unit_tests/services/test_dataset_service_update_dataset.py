import datetime
from typing import Any

# Mock redis_client before importing dataset_service
from unittest.mock import Mock, create_autospec, patch

import pytest

from core.model_runtime.entities.model_entities import ModelType
from models.account import Account
from models.dataset import Dataset, ExternalKnowledgeBindings
from services.dataset_service import DatasetService
from services.errors.account import NoPermissionError


class DatasetUpdateTestDataFactory:
    """Factory class for creating test data and mock objects for dataset update tests."""

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        provider: str = "vendor",
        name: str = "old_name",
        description: str = "old_description",
        indexing_technique: str = "high_quality",
        retrieval_model: str = "old_model",
        embedding_model_provider: str | None = None,
        embedding_model: str | None = None,
        collection_binding_id: str | None = None,
        **kwargs,
    ) -> Mock:
        """Create a mock dataset with specified attributes."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.provider = provider
        dataset.name = name
        dataset.description = description
        dataset.indexing_technique = indexing_technique
        dataset.retrieval_model = retrieval_model
        dataset.embedding_model_provider = embedding_model_provider
        dataset.embedding_model = embedding_model
        dataset.collection_binding_id = collection_binding_id
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_user_mock(user_id: str = "user-789") -> Mock:
        """Create a mock user."""
        user = Mock()
        user.id = user_id
        return user

    @staticmethod
    def create_external_binding_mock(
        external_knowledge_id: str = "old_knowledge_id", external_knowledge_api_id: str = "old_api_id"
    ) -> Mock:
        """Create a mock external knowledge binding."""
        binding = Mock(spec=ExternalKnowledgeBindings)
        binding.external_knowledge_id = external_knowledge_id
        binding.external_knowledge_api_id = external_knowledge_api_id
        return binding

    @staticmethod
    def create_embedding_model_mock(model: str = "text-embedding-ada-002", provider: str = "openai") -> Mock:
        """Create a mock embedding model."""
        embedding_model = Mock()
        embedding_model.model = model
        embedding_model.provider = provider
        return embedding_model

    @staticmethod
    def create_collection_binding_mock(binding_id: str = "binding-456") -> Mock:
        """Create a mock collection binding."""
        binding = Mock()
        binding.id = binding_id
        return binding

    @staticmethod
    def create_current_user_mock(tenant_id: str = "tenant-123") -> Mock:
        """Create a mock current user."""
        current_user = create_autospec(Account, instance=True)
        current_user.current_tenant_id = tenant_id
        return current_user


class TestDatasetServiceUpdateDataset:
    """
    Comprehensive unit tests for DatasetService.update_dataset method.

    This test suite covers all supported scenarios including:
    - External dataset updates
    - Internal dataset updates with different indexing techniques
    - Embedding model updates
    - Permission checks
    - Error conditions and edge cases
    """

    @pytest.fixture
    def mock_dataset_service_dependencies(self):
        """Common mock setup for dataset service dependencies."""
        with (
            patch("services.dataset_service.DatasetService.get_dataset") as mock_get_dataset,
            patch("services.dataset_service.DatasetService.check_dataset_permission") as mock_check_perm,
            patch("extensions.ext_database.db.session") as mock_db,
            patch("services.dataset_service.naive_utc_now") as mock_naive_utc_now,
            patch("services.dataset_service.DatasetService._has_dataset_same_name") as has_dataset_same_name,
        ):
            current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
            mock_naive_utc_now.return_value = current_time

            yield {
                "get_dataset": mock_get_dataset,
                "check_permission": mock_check_perm,
                "db_session": mock_db,
                "naive_utc_now": mock_naive_utc_now,
                "current_time": current_time,
                "has_dataset_same_name": has_dataset_same_name,
            }

    @pytest.fixture
    def mock_external_provider_dependencies(self):
        """Mock setup for external provider tests."""
        with patch("services.dataset_service.Session") as mock_session:
            from extensions.ext_database import db

            with patch.object(db.__class__, "engine", new_callable=Mock):
                session_mock = Mock()
                mock_session.return_value.__enter__.return_value = session_mock
                yield session_mock

    @pytest.fixture
    def mock_internal_provider_dependencies(self):
        """Mock setup for internal provider tests."""
        with (
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding"
            ) as mock_get_binding,
            patch("services.dataset_service.deal_dataset_vector_index_task") as mock_task,
            patch(
                "services.dataset_service.current_user", create_autospec(Account, instance=True)
            ) as mock_current_user,
        ):
            mock_current_user.current_tenant_id = "tenant-123"
            yield {
                "model_manager": mock_model_manager,
                "get_binding": mock_get_binding,
                "task": mock_task,
                "current_user": mock_current_user,
            }

    def _assert_database_update_called(self, mock_db, dataset_id: str, expected_updates: dict[str, Any]):
        """Helper method to verify database update calls."""
        mock_db.query.return_value.filter_by.return_value.update.assert_called_once_with(expected_updates)
        mock_db.commit.assert_called_once()

    def _assert_external_dataset_update(self, mock_dataset, mock_binding, update_data: dict[str, Any]):
        """Helper method to verify external dataset updates."""
        assert mock_dataset.name == update_data.get("name", mock_dataset.name)
        assert mock_dataset.description == update_data.get("description", mock_dataset.description)
        assert mock_dataset.retrieval_model == update_data.get("external_retrieval_model", mock_dataset.retrieval_model)

        if "external_knowledge_id" in update_data:
            assert mock_binding.external_knowledge_id == update_data["external_knowledge_id"]
        if "external_knowledge_api_id" in update_data:
            assert mock_binding.external_knowledge_api_id == update_data["external_knowledge_api_id"]

    # ==================== External Dataset Tests ====================

    def test_update_external_dataset_success(
        self, mock_dataset_service_dependencies, mock_external_provider_dependencies
    ):
        """Test successful update of external dataset."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock(
            provider="external", name="old_name", description="old_description", retrieval_model="old_model"
        )
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()
        binding = DatasetUpdateTestDataFactory.create_external_binding_mock()

        # Mock external knowledge binding query
        mock_external_provider_dependencies.query.return_value.filter_by.return_value.first.return_value = binding

        update_data = {
            "name": "new_name",
            "description": "new_description",
            "external_retrieval_model": "new_model",
            "permission": "only_me",
            "external_knowledge_id": "new_knowledge_id",
            "external_knowledge_api_id": "new_api_id",
        }

        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False
        result = DatasetService.update_dataset("dataset-123", update_data, user)

        mock_dataset_service_dependencies["check_permission"].assert_called_once_with(dataset, user)

        # Verify dataset and binding updates
        self._assert_external_dataset_update(dataset, binding, update_data)

        # Verify database operations
        mock_db = mock_dataset_service_dependencies["db_session"]
        mock_db.add.assert_any_call(dataset)
        mock_db.add.assert_any_call(binding)
        mock_db.commit.assert_called_once()

        # Verify return value
        assert result == dataset

    def test_update_external_dataset_missing_knowledge_id_error(self, mock_dataset_service_dependencies):
        """Test error when external knowledge id is missing."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock(provider="external")
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()
        update_data = {"name": "new_name", "external_knowledge_api_id": "api_id"}
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset("dataset-123", update_data, user)

        assert "External knowledge id is required" in str(context.value)

    def test_update_external_dataset_missing_api_id_error(self, mock_dataset_service_dependencies):
        """Test error when external knowledge api id is missing."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock(provider="external")
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()
        update_data = {"name": "new_name", "external_knowledge_id": "knowledge_id"}
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset("dataset-123", update_data, user)

        assert "External knowledge api id is required" in str(context.value)

    def test_update_external_dataset_binding_not_found_error(
        self, mock_dataset_service_dependencies, mock_external_provider_dependencies
    ):
        """Test error when external knowledge binding is not found."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock(provider="external")
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()

        # Mock external knowledge binding query returning None
        mock_external_provider_dependencies.query.return_value.filter_by.return_value.first.return_value = None

        update_data = {
            "name": "new_name",
            "external_knowledge_id": "knowledge_id",
            "external_knowledge_api_id": "api_id",
        }
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset("dataset-123", update_data, user)

        assert "External knowledge binding not found" in str(context.value)

    # ==================== Internal Dataset Basic Tests ====================

    def test_update_internal_dataset_basic_success(self, mock_dataset_service_dependencies):
        """Test successful update of internal dataset with basic fields."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock(
            provider="vendor",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
            collection_binding_id="binding-123",
        )
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()

        update_data = {
            "name": "new_name",
            "description": "new_description",
            "indexing_technique": "high_quality",
            "retrieval_model": "new_model",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
        }

        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False
        result = DatasetService.update_dataset("dataset-123", update_data, user)

        # Verify permission check was called
        mock_dataset_service_dependencies["check_permission"].assert_called_once_with(dataset, user)

        # Verify database update was called with correct filtered data
        expected_filtered_data = {
            "name": "new_name",
            "description": "new_description",
            "indexing_technique": "high_quality",
            "retrieval_model": "new_model",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
            "updated_by": user.id,
            "updated_at": mock_dataset_service_dependencies["current_time"],
        }

        self._assert_database_update_called(
            mock_dataset_service_dependencies["db_session"], "dataset-123", expected_filtered_data
        )

        # Verify return value
        assert result == dataset

    def test_update_internal_dataset_filter_none_values(self, mock_dataset_service_dependencies):
        """Test that None values are filtered out except for description field."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock(provider="vendor", indexing_technique="high_quality")
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()

        update_data = {
            "name": "new_name",
            "description": None,  # Should be included
            "indexing_technique": "high_quality",
            "retrieval_model": "new_model",
            "embedding_model_provider": None,  # Should be filtered out
            "embedding_model": None,  # Should be filtered out
        }

        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        result = DatasetService.update_dataset("dataset-123", update_data, user)

        # Verify database update was called with filtered data
        expected_filtered_data = {
            "name": "new_name",
            "description": None,  # Description should be included even if None
            "indexing_technique": "high_quality",
            "retrieval_model": "new_model",
            "updated_by": user.id,
            "updated_at": mock_dataset_service_dependencies["current_time"],
        }

        actual_call_args = mock_dataset_service_dependencies[
            "db_session"
        ].query.return_value.filter_by.return_value.update.call_args[0][0]
        # Remove timestamp for comparison as it's dynamic
        del actual_call_args["updated_at"]
        del expected_filtered_data["updated_at"]

        assert actual_call_args == expected_filtered_data

        # Verify return value
        assert result == dataset

    # ==================== Indexing Technique Switch Tests ====================

    def test_update_internal_dataset_indexing_technique_to_economy(
        self, mock_dataset_service_dependencies, mock_internal_provider_dependencies
    ):
        """Test updating internal dataset indexing technique to economy."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock(provider="vendor", indexing_technique="high_quality")
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()

        update_data = {"indexing_technique": "economy", "retrieval_model": "new_model"}
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        result = DatasetService.update_dataset("dataset-123", update_data, user)

        # Verify database update was called with embedding model fields cleared
        expected_filtered_data = {
            "indexing_technique": "economy",
            "embedding_model": None,
            "embedding_model_provider": None,
            "collection_binding_id": None,
            "retrieval_model": "new_model",
            "updated_by": user.id,
            "updated_at": mock_dataset_service_dependencies["current_time"],
        }

        self._assert_database_update_called(
            mock_dataset_service_dependencies["db_session"], "dataset-123", expected_filtered_data
        )

        # Verify return value
        assert result == dataset

    def test_update_internal_dataset_indexing_technique_to_high_quality(
        self, mock_dataset_service_dependencies, mock_internal_provider_dependencies
    ):
        """Test updating internal dataset indexing technique to high_quality."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock(provider="vendor", indexing_technique="economy")
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()

        # Mock embedding model
        embedding_model = DatasetUpdateTestDataFactory.create_embedding_model_mock()
        mock_internal_provider_dependencies[
            "model_manager"
        ].return_value.get_model_instance.return_value = embedding_model

        # Mock collection binding
        binding = DatasetUpdateTestDataFactory.create_collection_binding_mock()
        mock_internal_provider_dependencies["get_binding"].return_value = binding

        update_data = {
            "indexing_technique": "high_quality",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
            "retrieval_model": "new_model",
        }
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        result = DatasetService.update_dataset("dataset-123", update_data, user)

        # Verify embedding model was validated
        mock_internal_provider_dependencies["model_manager"].return_value.get_model_instance.assert_called_once_with(
            tenant_id=mock_internal_provider_dependencies["current_user"].current_tenant_id,
            provider="openai",
            model_type=ModelType.TEXT_EMBEDDING,
            model="text-embedding-ada-002",
        )

        # Verify collection binding was retrieved
        mock_internal_provider_dependencies["get_binding"].assert_called_once_with("openai", "text-embedding-ada-002")

        # Verify database update was called with correct data
        expected_filtered_data = {
            "indexing_technique": "high_quality",
            "embedding_model": "text-embedding-ada-002",
            "embedding_model_provider": "openai",
            "collection_binding_id": "binding-456",
            "retrieval_model": "new_model",
            "updated_by": user.id,
            "updated_at": mock_dataset_service_dependencies["current_time"],
        }

        self._assert_database_update_called(
            mock_dataset_service_dependencies["db_session"], "dataset-123", expected_filtered_data
        )

        # Verify vector index task was triggered
        mock_internal_provider_dependencies["task"].delay.assert_called_once_with("dataset-123", "add")

        # Verify return value
        assert result == dataset

    # ==================== Embedding Model Update Tests ====================

    def test_update_internal_dataset_keep_existing_embedding_model(self, mock_dataset_service_dependencies):
        """Test updating internal dataset without changing embedding model."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock(
            provider="vendor",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
            collection_binding_id="binding-123",
        )
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()

        update_data = {"name": "new_name", "indexing_technique": "high_quality", "retrieval_model": "new_model"}
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        result = DatasetService.update_dataset("dataset-123", update_data, user)

        # Verify database update was called with existing embedding model preserved
        expected_filtered_data = {
            "name": "new_name",
            "indexing_technique": "high_quality",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
            "collection_binding_id": "binding-123",
            "retrieval_model": "new_model",
            "updated_by": user.id,
            "updated_at": mock_dataset_service_dependencies["current_time"],
        }

        self._assert_database_update_called(
            mock_dataset_service_dependencies["db_session"], "dataset-123", expected_filtered_data
        )

        # Verify return value
        assert result == dataset

    def test_update_internal_dataset_embedding_model_update(
        self, mock_dataset_service_dependencies, mock_internal_provider_dependencies
    ):
        """Test updating internal dataset with new embedding model."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock(
            provider="vendor",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
        )
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()

        # Mock embedding model
        embedding_model = DatasetUpdateTestDataFactory.create_embedding_model_mock("text-embedding-3-small")
        mock_internal_provider_dependencies[
            "model_manager"
        ].return_value.get_model_instance.return_value = embedding_model

        # Mock collection binding
        binding = DatasetUpdateTestDataFactory.create_collection_binding_mock("binding-789")
        mock_internal_provider_dependencies["get_binding"].return_value = binding

        update_data = {
            "indexing_technique": "high_quality",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-3-small",
            "retrieval_model": "new_model",
        }
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        result = DatasetService.update_dataset("dataset-123", update_data, user)

        # Verify embedding model was validated
        mock_internal_provider_dependencies["model_manager"].return_value.get_model_instance.assert_called_once_with(
            tenant_id=mock_internal_provider_dependencies["current_user"].current_tenant_id,
            provider="openai",
            model_type=ModelType.TEXT_EMBEDDING,
            model="text-embedding-3-small",
        )

        # Verify collection binding was retrieved
        mock_internal_provider_dependencies["get_binding"].assert_called_once_with("openai", "text-embedding-3-small")

        # Verify database update was called with correct data
        expected_filtered_data = {
            "indexing_technique": "high_quality",
            "embedding_model": "text-embedding-3-small",
            "embedding_model_provider": "openai",
            "collection_binding_id": "binding-789",
            "retrieval_model": "new_model",
            "updated_by": user.id,
            "updated_at": mock_dataset_service_dependencies["current_time"],
        }

        self._assert_database_update_called(
            mock_dataset_service_dependencies["db_session"], "dataset-123", expected_filtered_data
        )

        # Verify vector index task was triggered
        mock_internal_provider_dependencies["task"].delay.assert_called_once_with("dataset-123", "update")

        # Verify return value
        assert result == dataset

    def test_update_internal_dataset_no_indexing_technique_change(self, mock_dataset_service_dependencies):
        """Test updating internal dataset without changing indexing technique."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock(
            provider="vendor",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
            collection_binding_id="binding-123",
        )
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()

        update_data = {
            "name": "new_name",
            "indexing_technique": "high_quality",  # Same as current
            "retrieval_model": "new_model",
        }
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        result = DatasetService.update_dataset("dataset-123", update_data, user)

        # Verify database update was called with correct data
        expected_filtered_data = {
            "name": "new_name",
            "indexing_technique": "high_quality",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
            "collection_binding_id": "binding-123",
            "retrieval_model": "new_model",
            "updated_by": user.id,
            "updated_at": mock_dataset_service_dependencies["current_time"],
        }

        self._assert_database_update_called(
            mock_dataset_service_dependencies["db_session"], "dataset-123", expected_filtered_data
        )

        # Verify return value
        assert result == dataset

    # ==================== Error Handling Tests ====================

    def test_update_dataset_not_found_error(self, mock_dataset_service_dependencies):
        """Test error when dataset is not found."""
        mock_dataset_service_dependencies["get_dataset"].return_value = None

        user = DatasetUpdateTestDataFactory.create_user_mock()
        update_data = {"name": "new_name"}
        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset("dataset-123", update_data, user)

        assert "Dataset not found" in str(context.value)

    def test_update_dataset_permission_error(self, mock_dataset_service_dependencies):
        """Test error when user doesn't have permission."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock()
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()
        mock_dataset_service_dependencies["check_permission"].side_effect = NoPermissionError("No permission")

        update_data = {"name": "new_name"}

        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        with pytest.raises(NoPermissionError):
            DatasetService.update_dataset("dataset-123", update_data, user)

    def test_update_internal_dataset_embedding_model_error(
        self, mock_dataset_service_dependencies, mock_internal_provider_dependencies
    ):
        """Test error when embedding model is not available."""
        dataset = DatasetUpdateTestDataFactory.create_dataset_mock(provider="vendor", indexing_technique="economy")
        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        user = DatasetUpdateTestDataFactory.create_user_mock()

        # Mock model manager to raise error
        mock_internal_provider_dependencies["model_manager"].return_value.get_model_instance.side_effect = Exception(
            "No Embedding Model available"
        )

        update_data = {
            "indexing_technique": "high_quality",
            "embedding_model_provider": "invalid_provider",
            "embedding_model": "invalid_model",
            "retrieval_model": "new_model",
        }

        mock_dataset_service_dependencies["has_dataset_same_name"].return_value = False

        with pytest.raises(Exception) as context:
            DatasetService.update_dataset("dataset-123", update_data, user)

        assert "No Embedding Model available".lower() in str(context.value).lower()
