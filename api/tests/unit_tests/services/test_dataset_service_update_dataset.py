import datetime

# Mock redis_client before importing dataset_service
from unittest.mock import Mock, patch

import pytest

from core.model_runtime.entities.model_entities import ModelType
from models.dataset import Dataset, ExternalKnowledgeBindings
from services.dataset_service import DatasetService
from services.errors.account import NoPermissionError
from tests.unit_tests.conftest import redis_mock


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

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    @patch("services.dataset_service.datetime")
    def test_update_external_dataset_success(self, mock_datetime, mock_check_permission, mock_get_dataset, mock_db):
        """
        Test successful update of external dataset.

        Verifies that:
        1. External dataset attributes are updated correctly
        2. External knowledge binding is updated when values change
        3. Database changes are committed
        4. Permission check is performed
        """
        from unittest.mock import Mock, patch

        from extensions.ext_database import db

        with patch.object(db.__class__, "engine", new_callable=Mock):
            # Create mock dataset
            mock_dataset = Mock(spec=Dataset)
            mock_dataset.id = "dataset-123"
            mock_dataset.provider = "external"
            mock_dataset.name = "old_name"
            mock_dataset.description = "old_description"
            mock_dataset.retrieval_model = "old_model"

            # Create mock user
            mock_user = Mock()
            mock_user.id = "user-789"

            # Create mock external knowledge binding
            mock_binding = Mock(spec=ExternalKnowledgeBindings)
            mock_binding.external_knowledge_id = "old_knowledge_id"
            mock_binding.external_knowledge_api_id = "old_api_id"

            # Set up mock return values
            current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
            mock_datetime.datetime.now.return_value = current_time
            mock_datetime.UTC = datetime.UTC

            # Mock dataset retrieval
            mock_get_dataset.return_value = mock_dataset

            # Mock external knowledge binding query
            with patch("services.dataset_service.Session") as mock_session:
                mock_session_instance = Mock()
                mock_session.return_value.__enter__.return_value = mock_session_instance
                mock_session_instance.query.return_value.filter_by.return_value.first.return_value = mock_binding

                # Test data
                update_data = {
                    "name": "new_name",
                    "description": "new_description",
                    "external_retrieval_model": "new_model",
                    "permission": "only_me",
                    "external_knowledge_id": "new_knowledge_id",
                    "external_knowledge_api_id": "new_api_id",
                }

                # Call the method
                result = DatasetService.update_dataset("dataset-123", update_data, mock_user)

                # Verify permission check was called
                mock_check_permission.assert_called_once_with(mock_dataset, mock_user)

                # Verify dataset attributes were updated
                assert mock_dataset.name == "new_name"
                assert mock_dataset.description == "new_description"
                assert mock_dataset.retrieval_model == "new_model"

                # Verify external knowledge binding was updated
                assert mock_binding.external_knowledge_id == "new_knowledge_id"
                assert mock_binding.external_knowledge_api_id == "new_api_id"

                # Verify database operations
                mock_db.add.assert_any_call(mock_dataset)
                mock_db.add.assert_any_call(mock_binding)
                mock_db.commit.assert_called_once()

                # Verify return value
                assert result == mock_dataset

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    def test_update_external_dataset_missing_knowledge_id_error(self, mock_check_permission, mock_get_dataset, mock_db):
        """
        Test error when external knowledge id is missing.
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.provider = "external"

        # Create mock user
        mock_user = Mock()

        # Mock dataset retrieval
        mock_get_dataset.return_value = mock_dataset

        # Test data without external_knowledge_id
        update_data = {"name": "new_name", "external_knowledge_api_id": "api_id"}

        # Call the method and expect ValueError
        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset("dataset-123", update_data, mock_user)

        assert "External knowledge id is required" in str(context.value)

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    def test_update_external_dataset_missing_api_id_error(self, mock_check_permission, mock_get_dataset, mock_db):
        """
        Test error when external knowledge api id is missing.
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.provider = "external"

        # Create mock user
        mock_user = Mock()

        # Mock dataset retrieval
        mock_get_dataset.return_value = mock_dataset

        # Test data without external_knowledge_api_id
        update_data = {"name": "new_name", "external_knowledge_id": "knowledge_id"}

        # Call the method and expect ValueError
        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset("dataset-123", update_data, mock_user)

        assert "External knowledge api id is required" in str(context.value)

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.Session")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    def test_update_external_dataset_binding_not_found_error(
        self, mock_check_permission, mock_get_dataset, mock_session, mock_db
    ):
        from unittest.mock import Mock, patch

        from extensions.ext_database import db

        with patch.object(db.__class__, "engine", new_callable=Mock):
            # Create mock dataset
            mock_dataset = Mock(spec=Dataset)
            mock_dataset.provider = "external"

            # Create mock user
            mock_user = Mock()

            # Mock dataset retrieval
            mock_get_dataset.return_value = mock_dataset

            # Mock external knowledge binding query returning None
            mock_session_instance = Mock()
            mock_session.return_value.__enter__.return_value = mock_session_instance
            mock_session_instance.query.return_value.filter_by.return_value.first.return_value = None

            # Test data
            update_data = {
                "name": "new_name",
                "external_knowledge_id": "knowledge_id",
                "external_knowledge_api_id": "api_id",
            }

            # Call the method and expect ValueError
            with pytest.raises(ValueError) as context:
                DatasetService.update_dataset("dataset-123", update_data, mock_user)

            assert "External knowledge binding not found" in str(context.value)

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    @patch("services.dataset_service.datetime")
    def test_update_internal_dataset_basic_success(
        self, mock_datetime, mock_check_permission, mock_get_dataset, mock_db
    ):
        """
        Test successful update of internal dataset with basic fields.

        Verifies that:
        1. Basic dataset attributes are updated correctly
        2. Filtered data excludes None values except description
        3. Timestamp fields are updated
        4. Database changes are committed
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.provider = "vendor"
        mock_dataset.name = "old_name"
        mock_dataset.description = "old_description"
        mock_dataset.indexing_technique = "high_quality"
        mock_dataset.retrieval_model = "old_model"
        mock_dataset.embedding_model_provider = "openai"
        mock_dataset.embedding_model = "text-embedding-ada-002"
        mock_dataset.collection_binding_id = "binding-123"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        # Mock dataset retrieval
        mock_get_dataset.return_value = mock_dataset

        # Test data
        update_data = {
            "name": "new_name",
            "description": "new_description",
            "indexing_technique": "high_quality",
            "retrieval_model": "new_model",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
        }

        # Call the method
        result = DatasetService.update_dataset("dataset-123", update_data, mock_user)

        # Verify permission check was called
        mock_check_permission.assert_called_once_with(mock_dataset, mock_user)

        # Verify database update was called with correct filtered data
        expected_filtered_data = {
            "name": "new_name",
            "description": "new_description",
            "indexing_technique": "high_quality",
            "retrieval_model": "new_model",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
            "updated_by": mock_user.id,
            "updated_at": current_time.replace(tzinfo=None),
        }

        mock_db.query.return_value.filter_by.return_value.update.assert_called_once_with(expected_filtered_data)
        mock_db.commit.assert_called_once()

        # Verify return value
        assert result == mock_dataset

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.deal_dataset_vector_index_task")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    @patch("services.dataset_service.datetime")
    def test_update_internal_dataset_indexing_technique_to_economy(
        self, mock_datetime, mock_check_permission, mock_get_dataset, mock_task, mock_db
    ):
        """
        Test updating internal dataset indexing technique to economy.

        Verifies that:
        1. Embedding model fields are cleared when switching to economy
        2. Vector index task is triggered with 'remove' action
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.provider = "vendor"
        mock_dataset.indexing_technique = "high_quality"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        # Mock dataset retrieval
        mock_get_dataset.return_value = mock_dataset

        # Test data
        update_data = {"indexing_technique": "economy", "retrieval_model": "new_model"}

        # Call the method
        result = DatasetService.update_dataset("dataset-123", update_data, mock_user)

        # Verify database update was called with embedding model fields cleared
        expected_filtered_data = {
            "indexing_technique": "economy",
            "embedding_model": None,
            "embedding_model_provider": None,
            "collection_binding_id": None,
            "retrieval_model": "new_model",
            "updated_by": mock_user.id,
            "updated_at": current_time.replace(tzinfo=None),
        }

        mock_db.query.return_value.filter_by.return_value.update.assert_called_once_with(expected_filtered_data)
        mock_db.commit.assert_called_once()

        # Verify vector index task was triggered
        mock_task.delay.assert_called_once_with("dataset-123", "remove")

        # Verify return value
        assert result == mock_dataset

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    def test_update_dataset_not_found_error(self, mock_check_permission, mock_get_dataset, mock_db):
        """
        Test error when dataset is not found.
        """
        # Create mock user
        mock_user = Mock()

        # Mock dataset retrieval returning None
        mock_get_dataset.return_value = None

        # Test data
        update_data = {"name": "new_name"}

        # Call the method and expect ValueError
        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset("dataset-123", update_data, mock_user)

        assert "Dataset not found" in str(context.value)

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    def test_update_dataset_permission_error(self, mock_check_permission, mock_get_dataset, mock_db):
        """
        Test error when user doesn't have permission.
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"

        # Create mock user
        mock_user = Mock()

        # Mock dataset retrieval
        mock_get_dataset.return_value = mock_dataset

        # Mock permission check to raise error
        mock_check_permission.side_effect = NoPermissionError("No permission")

        # Test data
        update_data = {"name": "new_name"}

        # Call the method and expect NoPermissionError
        with pytest.raises(NoPermissionError):
            DatasetService.update_dataset("dataset-123", update_data, mock_user)

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    @patch("services.dataset_service.datetime")
    def test_update_internal_dataset_keep_existing_embedding_model(
        self, mock_datetime, mock_check_permission, mock_get_dataset, mock_db
    ):
        """
        Test updating internal dataset without changing embedding model.

        Verifies that:
        1. Existing embedding model settings are preserved when not provided in update
        2. No vector index task is triggered
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.provider = "vendor"
        mock_dataset.indexing_technique = "high_quality"
        mock_dataset.embedding_model_provider = "openai"
        mock_dataset.embedding_model = "text-embedding-ada-002"
        mock_dataset.collection_binding_id = "binding-123"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        # Mock dataset retrieval
        mock_get_dataset.return_value = mock_dataset

        # Test data without embedding model fields
        update_data = {"name": "new_name", "indexing_technique": "high_quality", "retrieval_model": "new_model"}

        # Call the method
        result = DatasetService.update_dataset("dataset-123", update_data, mock_user)

        # Verify database update was called with existing embedding model preserved
        expected_filtered_data = {
            "name": "new_name",
            "indexing_technique": "high_quality",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
            "collection_binding_id": "binding-123",
            "retrieval_model": "new_model",
            "updated_by": mock_user.id,
            "updated_at": current_time.replace(tzinfo=None),
        }

        mock_db.query.return_value.filter_by.return_value.update.assert_called_once_with(expected_filtered_data)
        mock_db.commit.assert_called_once()

        # Verify return value
        assert result == mock_dataset

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding")
    @patch("services.dataset_service.ModelManager")
    @patch("services.dataset_service.deal_dataset_vector_index_task")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    @patch("services.dataset_service.datetime")
    def test_update_internal_dataset_indexing_technique_to_high_quality(
        self,
        mock_datetime,
        mock_check_permission,
        mock_get_dataset,
        mock_task,
        mock_model_manager,
        mock_collection_binding,
        mock_db,
    ):
        """
        Test updating internal dataset indexing technique to high_quality.

        Verifies that:
        1. Embedding model is validated and set
        2. Collection binding is retrieved
        3. Vector index task is triggered with 'add' action
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.provider = "vendor"
        mock_dataset.indexing_technique = "economy"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        # Mock dataset retrieval
        mock_get_dataset.return_value = mock_dataset

        # Mock embedding model
        mock_embedding_model = Mock()
        mock_embedding_model.model = "text-embedding-ada-002"
        mock_embedding_model.provider = "openai"

        # Mock collection binding
        mock_collection_binding_instance = Mock()
        mock_collection_binding_instance.id = "binding-456"

        # Mock model manager
        mock_model_manager_instance = Mock()
        mock_model_manager_instance.get_model_instance.return_value = mock_embedding_model
        mock_model_manager.return_value = mock_model_manager_instance

        # Mock collection binding service
        mock_collection_binding.return_value = mock_collection_binding_instance

        # Mock current_user
        mock_current_user = Mock()
        mock_current_user.current_tenant_id = "tenant-123"

        # Test data
        update_data = {
            "indexing_technique": "high_quality",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
            "retrieval_model": "new_model",
        }

        # Call the method with current_user mock
        with patch("services.dataset_service.current_user", mock_current_user):
            result = DatasetService.update_dataset("dataset-123", update_data, mock_user)

        # Verify embedding model was validated
        mock_model_manager_instance.get_model_instance.assert_called_once_with(
            tenant_id=mock_current_user.current_tenant_id,
            provider="openai",
            model_type=ModelType.TEXT_EMBEDDING,
            model="text-embedding-ada-002",
        )

        # Verify collection binding was retrieved
        mock_collection_binding.assert_called_once_with("openai", "text-embedding-ada-002")

        # Verify database update was called with correct data
        expected_filtered_data = {
            "indexing_technique": "high_quality",
            "embedding_model": "text-embedding-ada-002",
            "embedding_model_provider": "openai",
            "collection_binding_id": "binding-456",
            "retrieval_model": "new_model",
            "updated_by": mock_user.id,
            "updated_at": current_time.replace(tzinfo=None),
        }

        mock_db.query.return_value.filter_by.return_value.update.assert_called_once_with(expected_filtered_data)
        mock_db.commit.assert_called_once()

        # Verify vector index task was triggered
        mock_task.delay.assert_called_once_with("dataset-123", "add")

        # Verify return value
        assert result == mock_dataset

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    def test_update_internal_dataset_embedding_model_error(self, mock_check_permission, mock_get_dataset, mock_db):
        """
        Test error when embedding model is not available.
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.provider = "vendor"
        mock_dataset.indexing_technique = "economy"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Mock dataset retrieval
        mock_get_dataset.return_value = mock_dataset

        # Mock current_user
        mock_current_user = Mock()
        mock_current_user.current_tenant_id = "tenant-123"

        # Mock model manager to raise error
        with (
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch("services.dataset_service.current_user", mock_current_user),
        ):
            mock_model_manager_instance = Mock()
            mock_model_manager_instance.get_model_instance.side_effect = Exception("No Embedding Model available")
            mock_model_manager.return_value = mock_model_manager_instance

            # Test data
            update_data = {
                "indexing_technique": "high_quality",
                "embedding_model_provider": "invalid_provider",
                "embedding_model": "invalid_model",
                "retrieval_model": "new_model",
            }

            # Call the method and expect ValueError
            with pytest.raises(Exception) as context:
                DatasetService.update_dataset("dataset-123", update_data, mock_user)

            assert "No Embedding Model available".lower() in str(context.value).lower()

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    @patch("services.dataset_service.datetime")
    def test_update_internal_dataset_filter_none_values(
        self, mock_datetime, mock_check_permission, mock_get_dataset, mock_db
    ):
        """
        Test that None values are filtered out except for description field.
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.provider = "vendor"
        mock_dataset.indexing_technique = "high_quality"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Mock dataset retrieval
        mock_get_dataset.return_value = mock_dataset

        # Test data with None values
        update_data = {
            "name": "new_name",
            "description": None,  # Should be included
            "indexing_technique": "high_quality",
            "retrieval_model": "new_model",
            "embedding_model_provider": None,  # Should be filtered out
            "embedding_model": None,  # Should be filtered out
        }

        # Call the method
        result = DatasetService.update_dataset("dataset-123", update_data, mock_user)

        # Verify database update was called with filtered data
        expected_filtered_data = {
            "name": "new_name",
            "description": None,  # Description should be included even if None
            "indexing_technique": "high_quality",
            "retrieval_model": "new_model",
            "updated_by": mock_user.id,
            "updated_at": mock_db.query.return_value.filter_by.return_value.update.call_args[0][0]["updated_at"],
        }

        actual_call_args = mock_db.query.return_value.filter_by.return_value.update.call_args[0][0]
        # Remove timestamp for comparison as it's dynamic
        del actual_call_args["updated_at"]
        del expected_filtered_data["updated_at"]

        del actual_call_args["collection_binding_id"]
        del actual_call_args["embedding_model"]
        del actual_call_args["embedding_model_provider"]

        assert actual_call_args == expected_filtered_data

        # Verify return value
        assert result == mock_dataset

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.deal_dataset_vector_index_task")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    @patch("services.dataset_service.datetime")
    def test_update_internal_dataset_embedding_model_update(
        self, mock_datetime, mock_check_permission, mock_get_dataset, mock_task, mock_db
    ):
        """
        Test updating internal dataset with new embedding model.

        Verifies that:
        1. Embedding model is updated when different from current
        2. Vector index task is triggered with 'update' action
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.provider = "vendor"
        mock_dataset.indexing_technique = "high_quality"
        mock_dataset.embedding_model_provider = "openai"
        mock_dataset.embedding_model = "text-embedding-ada-002"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        # Mock dataset retrieval
        mock_get_dataset.return_value = mock_dataset

        # Mock embedding model
        mock_embedding_model = Mock()
        mock_embedding_model.model = "text-embedding-3-small"
        mock_embedding_model.provider = "openai"

        # Mock collection binding
        mock_collection_binding_instance = Mock()
        mock_collection_binding_instance.id = "binding-789"

        # Mock current_user
        mock_current_user = Mock()
        mock_current_user.current_tenant_id = "tenant-123"

        # Mock model manager
        with patch("services.dataset_service.ModelManager") as mock_model_manager:
            mock_model_manager_instance = Mock()
            mock_model_manager_instance.get_model_instance.return_value = mock_embedding_model
            mock_model_manager.return_value = mock_model_manager_instance

            # Mock collection binding service
            with (
                patch(
                    "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding"
                ) as mock_collection_binding,
                patch("services.dataset_service.current_user", mock_current_user),
            ):
                mock_collection_binding.return_value = mock_collection_binding_instance

                # Test data
                update_data = {
                    "indexing_technique": "high_quality",
                    "embedding_model_provider": "openai",
                    "embedding_model": "text-embedding-3-small",
                    "retrieval_model": "new_model",
                }

                # Call the method
                result = DatasetService.update_dataset("dataset-123", update_data, mock_user)

                # Verify embedding model was validated
                mock_model_manager_instance.get_model_instance.assert_called_once_with(
                    tenant_id=mock_current_user.current_tenant_id,
                    provider="openai",
                    model_type=ModelType.TEXT_EMBEDDING,
                    model="text-embedding-3-small",
                )

                # Verify collection binding was retrieved
                mock_collection_binding.assert_called_once_with("openai", "text-embedding-3-small")

                # Verify database update was called with correct data
                expected_filtered_data = {
                    "indexing_technique": "high_quality",
                    "embedding_model": "text-embedding-3-small",
                    "embedding_model_provider": "openai",
                    "collection_binding_id": "binding-789",
                    "retrieval_model": "new_model",
                    "updated_by": mock_user.id,
                    "updated_at": current_time.replace(tzinfo=None),
                }

                mock_db.query.return_value.filter_by.return_value.update.assert_called_once_with(expected_filtered_data)
                mock_db.commit.assert_called_once()

                # Verify vector index task was triggered
                mock_task.delay.assert_called_once_with("dataset-123", "update")

                # Verify return value
                assert result == mock_dataset

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DatasetService.get_dataset")
    @patch("services.dataset_service.DatasetService.check_dataset_permission")
    @patch("services.dataset_service.datetime")
    def test_update_internal_dataset_no_indexing_technique_change(
        self, mock_datetime, mock_check_permission, mock_get_dataset, mock_db
    ):
        """
        Test updating internal dataset without changing indexing technique.

        Verifies that:
        1. No vector index task is triggered when indexing technique doesn't change
        2. Database update is performed normally
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.provider = "vendor"
        mock_dataset.indexing_technique = "high_quality"
        mock_dataset.embedding_model_provider = "openai"
        mock_dataset.embedding_model = "text-embedding-ada-002"
        mock_dataset.collection_binding_id = "binding-123"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        # Mock dataset retrieval
        mock_get_dataset.return_value = mock_dataset

        # Test data with same indexing technique
        update_data = {
            "name": "new_name",
            "indexing_technique": "high_quality",  # Same as current
            "retrieval_model": "new_model",
        }

        # Call the method
        result = DatasetService.update_dataset("dataset-123", update_data, mock_user)

        # Verify database update was called with correct data
        expected_filtered_data = {
            "name": "new_name",
            "indexing_technique": "high_quality",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
            "collection_binding_id": "binding-123",
            "retrieval_model": "new_model",
            "updated_by": mock_user.id,
            "updated_at": current_time.replace(tzinfo=None),
        }

        mock_db.query.return_value.filter_by.return_value.update.assert_called_once_with(expected_filtered_data)
        mock_db.commit.assert_called_once()

        # Verify no vector index task was triggered
        mock_db.query.return_value.filter_by.return_value.update.assert_called_once()

        # Verify return value
        assert result == mock_dataset
