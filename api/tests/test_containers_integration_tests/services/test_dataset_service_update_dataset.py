from unittest.mock import Mock, patch
from uuid import uuid4

import pytest

from core.model_runtime.entities.model_entities import ModelType
from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, ExternalKnowledgeBindings
from services.dataset_service import DatasetService
from services.errors.account import NoPermissionError


class DatasetUpdateTestDataFactory:
    """Factory class for creating real test data for dataset update integration tests."""

    @staticmethod
    def create_account_with_tenant(role: TenantAccountRole = TenantAccountRole.OWNER) -> tuple[Account, Tenant]:
        """Create a real account and tenant with the given role."""
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status="active",
        )
        db.session.add(account)
        db.session.commit()

        tenant = Tenant(name=f"tenant-{account.id}", status="normal")
        db.session.add(tenant)
        db.session.commit()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=role,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        account.current_tenant = tenant
        return account, tenant

    @staticmethod
    def create_dataset(
        tenant_id: str,
        created_by: str,
        provider: str = "vendor",
        name: str = "old_name",
        description: str = "old_description",
        indexing_technique: str = "high_quality",
        retrieval_model: str = "old_model",
        permission: str = "only_me",
        embedding_model_provider: str | None = None,
        embedding_model: str | None = None,
        collection_binding_id: str | None = None,
    ) -> Dataset:
        """Create a real dataset."""
        dataset = Dataset(
            tenant_id=tenant_id,
            name=name,
            description=description,
            data_source_type="upload_file",
            indexing_technique=indexing_technique,
            created_by=created_by,
            provider=provider,
            retrieval_model=retrieval_model,
            permission=permission,
            embedding_model_provider=embedding_model_provider,
            embedding_model=embedding_model,
            collection_binding_id=collection_binding_id,
        )
        db.session.add(dataset)
        db.session.commit()
        return dataset

    @staticmethod
    def create_external_binding(
        tenant_id: str,
        dataset_id: str,
        created_by: str,
        external_knowledge_id: str = "old_knowledge_id",
        external_knowledge_api_id: str | None = None,
    ) -> ExternalKnowledgeBindings:
        """Create a real external knowledge binding."""
        if external_knowledge_api_id is None:
            external_knowledge_api_id = str(uuid4())
        binding = ExternalKnowledgeBindings(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            created_by=created_by,
            external_knowledge_id=external_knowledge_id,
            external_knowledge_api_id=external_knowledge_api_id,
        )
        db.session.add(binding)
        db.session.commit()
        return binding


class TestDatasetServiceUpdateDataset:
    """
    Comprehensive integration tests for DatasetService.update_dataset method.

    This test suite covers all supported scenarios including:
    - External dataset updates
    - Internal dataset updates with different indexing techniques
    - Embedding model updates
    - Permission checks
    - Error conditions and edge cases
    """

    # ==================== External Dataset Tests ====================

    def test_update_external_dataset_success(self, db_session_with_containers):
        """Test successful update of external dataset."""
        user, tenant = DatasetUpdateTestDataFactory.create_account_with_tenant()
        dataset = DatasetUpdateTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=user.id,
            provider="external",
            name="old_name",
            description="old_description",
            retrieval_model="old_model",
        )
        binding = DatasetUpdateTestDataFactory.create_external_binding(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            created_by=user.id,
        )
        binding_id = binding.id
        db.session.expunge(binding)

        update_data = {
            "name": "new_name",
            "description": "new_description",
            "external_retrieval_model": "new_model",
            "permission": "only_me",
            "external_knowledge_id": "new_knowledge_id",
            "external_knowledge_api_id": str(uuid4()),
        }

        result = DatasetService.update_dataset(dataset.id, update_data, user)

        db.session.refresh(dataset)
        updated_binding = db.session.query(ExternalKnowledgeBindings).filter_by(id=binding_id).first()

        assert dataset.name == "new_name"
        assert dataset.description == "new_description"
        assert dataset.retrieval_model == "new_model"
        assert updated_binding is not None
        assert updated_binding.external_knowledge_id == "new_knowledge_id"
        assert updated_binding.external_knowledge_api_id == update_data["external_knowledge_api_id"]
        assert result.id == dataset.id

    def test_update_external_dataset_missing_knowledge_id_error(self, db_session_with_containers):
        """Test error when external knowledge id is missing."""
        user, tenant = DatasetUpdateTestDataFactory.create_account_with_tenant()
        dataset = DatasetUpdateTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=user.id,
            provider="external",
        )
        DatasetUpdateTestDataFactory.create_external_binding(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            created_by=user.id,
        )

        update_data = {"name": "new_name", "external_knowledge_api_id": str(uuid4())}

        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset(dataset.id, update_data, user)

        assert "External knowledge id is required" in str(context.value)
        db.session.rollback()

    def test_update_external_dataset_missing_api_id_error(self, db_session_with_containers):
        """Test error when external knowledge api id is missing."""
        user, tenant = DatasetUpdateTestDataFactory.create_account_with_tenant()
        dataset = DatasetUpdateTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=user.id,
            provider="external",
        )
        DatasetUpdateTestDataFactory.create_external_binding(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            created_by=user.id,
        )

        update_data = {"name": "new_name", "external_knowledge_id": "knowledge_id"}

        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset(dataset.id, update_data, user)

        assert "External knowledge api id is required" in str(context.value)
        db.session.rollback()

    def test_update_external_dataset_binding_not_found_error(self, db_session_with_containers):
        """Test error when external knowledge binding is not found."""
        user, tenant = DatasetUpdateTestDataFactory.create_account_with_tenant()
        dataset = DatasetUpdateTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=user.id,
            provider="external",
        )

        update_data = {
            "name": "new_name",
            "external_knowledge_id": "knowledge_id",
            "external_knowledge_api_id": str(uuid4()),
        }

        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset(dataset.id, update_data, user)

        assert "External knowledge binding not found" in str(context.value)
        db.session.rollback()

    # ==================== Internal Dataset Basic Tests ====================

    def test_update_internal_dataset_basic_success(self, db_session_with_containers):
        """Test successful update of internal dataset with basic fields."""
        user, tenant = DatasetUpdateTestDataFactory.create_account_with_tenant()
        existing_binding_id = str(uuid4())
        dataset = DatasetUpdateTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=user.id,
            provider="vendor",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
            collection_binding_id=existing_binding_id,
        )

        update_data = {
            "name": "new_name",
            "description": "new_description",
            "indexing_technique": "high_quality",
            "retrieval_model": "new_model",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
        }

        result = DatasetService.update_dataset(dataset.id, update_data, user)
        db.session.refresh(dataset)

        assert dataset.name == "new_name"
        assert dataset.description == "new_description"
        assert dataset.indexing_technique == "high_quality"
        assert dataset.retrieval_model == "new_model"
        assert dataset.embedding_model_provider == "openai"
        assert dataset.embedding_model == "text-embedding-ada-002"
        assert result.id == dataset.id

    def test_update_internal_dataset_filter_none_values(self, db_session_with_containers):
        """Test that None values are filtered out except for description field."""
        user, tenant = DatasetUpdateTestDataFactory.create_account_with_tenant()
        existing_binding_id = str(uuid4())
        dataset = DatasetUpdateTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=user.id,
            provider="vendor",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
            collection_binding_id=existing_binding_id,
        )

        update_data = {
            "name": "new_name",
            "description": None,
            "indexing_technique": "high_quality",
            "retrieval_model": "new_model",
            "embedding_model_provider": None,
            "embedding_model": None,
        }

        result = DatasetService.update_dataset(dataset.id, update_data, user)
        db.session.refresh(dataset)

        assert dataset.name == "new_name"
        assert dataset.description is None
        assert dataset.embedding_model_provider == "openai"
        assert dataset.embedding_model == "text-embedding-ada-002"
        assert dataset.retrieval_model == "new_model"
        assert result.id == dataset.id

    # ==================== Indexing Technique Switch Tests ====================

    def test_update_internal_dataset_indexing_technique_to_economy(self, db_session_with_containers):
        """Test updating internal dataset indexing technique to economy."""
        user, tenant = DatasetUpdateTestDataFactory.create_account_with_tenant()
        existing_binding_id = str(uuid4())
        dataset = DatasetUpdateTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=user.id,
            provider="vendor",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
            collection_binding_id=existing_binding_id,
        )

        update_data = {
            "indexing_technique": "economy",
            "retrieval_model": "new_model",
        }

        with patch("services.dataset_service.deal_dataset_vector_index_task") as mock_task:
            result = DatasetService.update_dataset(dataset.id, update_data, user)
            mock_task.delay.assert_called_once_with(dataset.id, "remove")

        db.session.refresh(dataset)
        assert dataset.indexing_technique == "economy"
        assert dataset.embedding_model is None
        assert dataset.embedding_model_provider is None
        assert dataset.collection_binding_id is None
        assert dataset.retrieval_model == "new_model"
        assert result.id == dataset.id

    def test_update_internal_dataset_indexing_technique_to_high_quality(self, db_session_with_containers):
        """Test updating internal dataset indexing technique to high_quality."""
        user, tenant = DatasetUpdateTestDataFactory.create_account_with_tenant()
        dataset = DatasetUpdateTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=user.id,
            provider="vendor",
            indexing_technique="economy",
        )

        embedding_model = Mock()
        embedding_model.model = "text-embedding-ada-002"
        embedding_model.provider = "openai"

        binding = Mock()
        binding.id = str(uuid4())

        update_data = {
            "indexing_technique": "high_quality",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-ada-002",
            "retrieval_model": "new_model",
        }

        with (
            patch("services.dataset_service.current_user", user),
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding"
            ) as mock_get_binding,
            patch("services.dataset_service.deal_dataset_vector_index_task") as mock_task,
        ):
            mock_model_manager.return_value.get_model_instance.return_value = embedding_model
            mock_get_binding.return_value = binding

            result = DatasetService.update_dataset(dataset.id, update_data, user)

            mock_model_manager.return_value.get_model_instance.assert_called_once_with(
                tenant_id=tenant.id,
                provider="openai",
                model_type=ModelType.TEXT_EMBEDDING,
                model="text-embedding-ada-002",
            )
            mock_get_binding.assert_called_once_with("openai", "text-embedding-ada-002")
            mock_task.delay.assert_called_once_with(dataset.id, "add")

        db.session.refresh(dataset)
        assert dataset.indexing_technique == "high_quality"
        assert dataset.embedding_model == "text-embedding-ada-002"
        assert dataset.embedding_model_provider == "openai"
        assert dataset.collection_binding_id == binding.id
        assert dataset.retrieval_model == "new_model"
        assert result.id == dataset.id

    # ==================== Embedding Model Update Tests ====================

    def test_update_internal_dataset_keep_existing_embedding_model_when_indexing_technique_unchanged(
        self, db_session_with_containers
    ):
        """Test preserving embedding settings when indexing technique remains unchanged."""
        user, tenant = DatasetUpdateTestDataFactory.create_account_with_tenant()
        existing_binding_id = str(uuid4())
        dataset = DatasetUpdateTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=user.id,
            provider="vendor",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
            collection_binding_id=existing_binding_id,
        )

        update_data = {
            "name": "new_name",
            "indexing_technique": "high_quality",
            "retrieval_model": "new_model",
        }

        result = DatasetService.update_dataset(dataset.id, update_data, user)
        db.session.refresh(dataset)

        assert dataset.name == "new_name"
        assert dataset.indexing_technique == "high_quality"
        assert dataset.embedding_model_provider == "openai"
        assert dataset.embedding_model == "text-embedding-ada-002"
        assert dataset.collection_binding_id == existing_binding_id
        assert dataset.retrieval_model == "new_model"
        assert result.id == dataset.id

    def test_update_internal_dataset_embedding_model_update(self, db_session_with_containers):
        """Test updating internal dataset with new embedding model."""
        user, tenant = DatasetUpdateTestDataFactory.create_account_with_tenant()
        existing_binding_id = str(uuid4())
        dataset = DatasetUpdateTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=user.id,
            provider="vendor",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
            collection_binding_id=existing_binding_id,
        )

        embedding_model = Mock()
        embedding_model.model = "text-embedding-3-small"
        embedding_model.provider = "openai"

        binding = Mock()
        binding.id = str(uuid4())

        update_data = {
            "indexing_technique": "high_quality",
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-3-small",
            "retrieval_model": "new_model",
        }

        with (
            patch("services.dataset_service.current_user", user),
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding"
            ) as mock_get_binding,
            patch("services.dataset_service.deal_dataset_vector_index_task") as mock_task,
            patch("services.dataset_service.regenerate_summary_index_task") as mock_regenerate_task,
        ):
            mock_model_manager.return_value.get_model_instance.return_value = embedding_model
            mock_get_binding.return_value = binding

            result = DatasetService.update_dataset(dataset.id, update_data, user)

            mock_model_manager.return_value.get_model_instance.assert_called_once_with(
                tenant_id=tenant.id,
                provider="openai",
                model_type=ModelType.TEXT_EMBEDDING,
                model="text-embedding-3-small",
            )
            mock_get_binding.assert_called_once_with("openai", "text-embedding-3-small")
            mock_task.delay.assert_called_once_with(dataset.id, "update")
            mock_regenerate_task.delay.assert_called_once_with(
                dataset.id,
                regenerate_reason="embedding_model_changed",
                regenerate_vectors_only=True,
            )

        db.session.refresh(dataset)
        assert dataset.embedding_model == "text-embedding-3-small"
        assert dataset.embedding_model_provider == "openai"
        assert dataset.collection_binding_id == binding.id
        assert dataset.retrieval_model == "new_model"
        assert result.id == dataset.id

    # ==================== Error Handling Tests ====================

    def test_update_dataset_not_found_error(self, db_session_with_containers):
        """Test error when dataset is not found."""
        user, _ = DatasetUpdateTestDataFactory.create_account_with_tenant()
        update_data = {"name": "new_name"}

        with pytest.raises(ValueError) as context:
            DatasetService.update_dataset(str(uuid4()), update_data, user)

        assert "Dataset not found" in str(context.value)

    def test_update_dataset_permission_error(self, db_session_with_containers):
        """Test error when user doesn't have permission."""
        owner, tenant = DatasetUpdateTestDataFactory.create_account_with_tenant(role=TenantAccountRole.OWNER)
        outsider, _ = DatasetUpdateTestDataFactory.create_account_with_tenant(role=TenantAccountRole.NORMAL)
        dataset = DatasetUpdateTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=owner.id,
            provider="vendor",
            permission="only_me",
        )

        update_data = {"name": "new_name"}

        with pytest.raises(NoPermissionError):
            DatasetService.update_dataset(dataset.id, update_data, outsider)

    def test_update_internal_dataset_embedding_model_error(self, db_session_with_containers):
        """Test error when embedding model is not available."""
        user, tenant = DatasetUpdateTestDataFactory.create_account_with_tenant()
        dataset = DatasetUpdateTestDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=user.id,
            provider="vendor",
            indexing_technique="economy",
        )

        update_data = {
            "indexing_technique": "high_quality",
            "embedding_model_provider": "invalid_provider",
            "embedding_model": "invalid_model",
            "retrieval_model": "new_model",
        }

        with (
            patch("services.dataset_service.current_user", user),
            patch("services.dataset_service.ModelManager") as mock_model_manager,
        ):
            mock_model_manager.return_value.get_model_instance.side_effect = Exception("No Embedding Model available")

            with pytest.raises(Exception) as context:
                DatasetService.update_dataset(dataset.id, update_data, user)

        assert "No Embedding Model available".lower() in str(context.value).lower()
