"""Integration tests for SQL-oriented DatasetService scenarios.

This suite migrates SQL-backed behaviors from the old unit suite to real
container-backed integration tests. The tests exercise real ORM persistence and
only patch non-DB collaborators when needed.
"""

from unittest.mock import Mock, patch
from uuid import uuid4

import pytest

from core.model_runtime.entities.model_entities import ModelType
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, DatasetPermissionEnum, Document, ExternalKnowledgeBindings
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.knowledge_entities import RerankingModel, RetrievalModel
from services.errors.dataset import DatasetNameDuplicateError


class DatasetServiceIntegrationDataFactory:
    """Factory for creating real database entities used by integration tests."""

    @staticmethod
    def create_account_with_tenant(role: TenantAccountRole = TenantAccountRole.OWNER) -> tuple[Account, Tenant]:
        """Create an account and tenant, then bind the account as current tenant member."""
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status="active",
        )
        tenant = Tenant(name=f"tenant-{uuid4()}", status="normal")
        db.session.add_all([account, tenant])
        db.session.flush()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=role,
            current=True,
        )
        db.session.add(join)
        db.session.flush()

        # Keep tenant context on the in-memory user without opening a separate session.
        account.role = role
        account._current_tenant = tenant
        return account, tenant

    @staticmethod
    def create_dataset(
        tenant_id: str,
        created_by: str,
        name: str = "Test Dataset",
        description: str | None = "Test description",
        provider: str = "vendor",
        indexing_technique: str | None = "high_quality",
        permission: str = DatasetPermissionEnum.ONLY_ME,
        retrieval_model: dict | None = None,
        embedding_model_provider: str | None = None,
        embedding_model: str | None = None,
        collection_binding_id: str | None = None,
        chunk_structure: str | None = None,
    ) -> Dataset:
        """Create a dataset record with configurable SQL fields."""
        dataset = Dataset(
            tenant_id=tenant_id,
            name=name,
            description=description,
            data_source_type="upload_file",
            indexing_technique=indexing_technique,
            created_by=created_by,
            provider=provider,
            permission=permission,
            retrieval_model=retrieval_model,
            embedding_model_provider=embedding_model_provider,
            embedding_model=embedding_model,
            collection_binding_id=collection_binding_id,
            chunk_structure=chunk_structure,
        )
        db.session.add(dataset)
        db.session.flush()
        return dataset

    @staticmethod
    def create_document(dataset: Dataset, created_by: str, name: str = "doc.txt") -> Document:
        """Create a document row belonging to the given dataset."""
        document = Document(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="upload_file",
            data_source_info='{"upload_file_id": "upload-file-id"}',
            batch=str(uuid4()),
            name=name,
            created_from="web",
            created_by=created_by,
            indexing_status="completed",
            doc_form="text_model",
        )
        db.session.add(document)
        db.session.flush()
        return document

    @staticmethod
    def create_embedding_model(provider: str = "openai", model_name: str = "text-embedding-ada-002") -> Mock:
        """Create a fake embedding model object for external provider boundary patching."""
        embedding_model = Mock()
        embedding_model.provider = provider
        embedding_model.model_name = model_name
        return embedding_model


class TestDatasetServiceCreateDataset:
    """Integration coverage for DatasetService.create_empty_dataset."""

    def test_create_internal_dataset_basic_success(self, db_session_with_containers):
        """Create a basic internal dataset with minimal configuration."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant()

        # Act
        result = DatasetService.create_empty_dataset(
            tenant_id=tenant.id,
            name="Basic Internal Dataset",
            description="Test description",
            indexing_technique=None,
            account=account,
        )

        # Assert
        created_dataset = db.session.get(Dataset, result.id)
        assert created_dataset is not None
        assert created_dataset.provider == "vendor"
        assert created_dataset.permission == DatasetPermissionEnum.ONLY_ME
        assert created_dataset.embedding_model_provider is None
        assert created_dataset.embedding_model is None

    def test_create_internal_dataset_with_economy_indexing(self, db_session_with_containers):
        """Create an internal dataset with economy indexing and no embedding model."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant()

        # Act
        result = DatasetService.create_empty_dataset(
            tenant_id=tenant.id,
            name="Economy Dataset",
            description=None,
            indexing_technique="economy",
            account=account,
        )

        # Assert
        db.session.refresh(result)
        assert result.indexing_technique == "economy"
        assert result.embedding_model_provider is None
        assert result.embedding_model is None

    def test_create_internal_dataset_with_high_quality_indexing(self, db_session_with_containers):
        """Create a high-quality dataset and persist embedding model settings."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant()
        embedding_model = DatasetServiceIntegrationDataFactory.create_embedding_model()

        # Act
        with patch("services.dataset_service.ModelManager") as mock_model_manager:
            mock_model_manager.return_value.get_default_model_instance.return_value = embedding_model

            result = DatasetService.create_empty_dataset(
                tenant_id=tenant.id,
                name="High Quality Dataset",
                description=None,
                indexing_technique="high_quality",
                account=account,
            )

        # Assert
        db.session.refresh(result)
        assert result.indexing_technique == "high_quality"
        assert result.embedding_model_provider == embedding_model.provider
        assert result.embedding_model == embedding_model.model_name
        mock_model_manager.return_value.get_default_model_instance.assert_called_once_with(
            tenant_id=tenant.id,
            model_type=ModelType.TEXT_EMBEDDING,
        )

    def test_create_dataset_duplicate_name_error(self, db_session_with_containers):
        """Raise duplicate-name error when the same tenant already has the name."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant()
        DatasetServiceIntegrationDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            name="Duplicate Dataset",
            indexing_technique=None,
        )

        # Act / Assert
        with pytest.raises(DatasetNameDuplicateError):
            DatasetService.create_empty_dataset(
                tenant_id=tenant.id,
                name="Duplicate Dataset",
                description=None,
                indexing_technique=None,
                account=account,
            )

    def test_create_external_dataset_success(self, db_session_with_containers):
        """Create an external dataset and persist external knowledge binding."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant()
        external_knowledge_api_id = str(uuid4())
        external_knowledge_id = "knowledge-123"

        # Act
        with patch("services.dataset_service.ExternalDatasetService.get_external_knowledge_api") as mock_get_api:
            mock_get_api.return_value = Mock(id=external_knowledge_api_id)
            result = DatasetService.create_empty_dataset(
                tenant_id=tenant.id,
                name="External Dataset",
                description=None,
                indexing_technique=None,
                account=account,
                provider="external",
                external_knowledge_api_id=external_knowledge_api_id,
                external_knowledge_id=external_knowledge_id,
            )

        # Assert
        binding = db.session.query(ExternalKnowledgeBindings).filter_by(dataset_id=result.id).first()
        assert result.provider == "external"
        assert binding is not None
        assert binding.external_knowledge_id == external_knowledge_id
        assert binding.external_knowledge_api_id == external_knowledge_api_id

    def test_create_dataset_with_retrieval_model_and_reranking(self, db_session_with_containers):
        """Create a high-quality dataset with retrieval/reranking settings."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant()
        embedding_model = DatasetServiceIntegrationDataFactory.create_embedding_model()
        retrieval_model = RetrievalModel(
            search_method=RetrievalMethod.SEMANTIC_SEARCH,
            reranking_enable=True,
            reranking_model=RerankingModel(
                reranking_provider_name="cohere",
                reranking_model_name="rerank-english-v2.0",
            ),
            top_k=3,
            score_threshold_enabled=True,
            score_threshold=0.6,
        )

        # Act
        with (
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch("services.dataset_service.DatasetService.check_reranking_model_setting") as mock_check_reranking,
        ):
            mock_model_manager.return_value.get_default_model_instance.return_value = embedding_model

            result = DatasetService.create_empty_dataset(
                tenant_id=tenant.id,
                name="Dataset With Reranking",
                description=None,
                indexing_technique="high_quality",
                account=account,
                retrieval_model=retrieval_model,
            )

        # Assert
        db.session.refresh(result)
        assert result.retrieval_model == retrieval_model.model_dump()
        mock_check_reranking.assert_called_once_with(tenant.id, "cohere", "rerank-english-v2.0")


class TestDatasetServiceUpdateAndDeleteDataset:
    """Integration coverage for SQL-backed update and delete behavior."""

    def test_update_dataset_duplicate_name_error(self, db_session_with_containers):
        """Reject update when target name already exists within the same tenant."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant()
        source_dataset = DatasetServiceIntegrationDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            name="Source Dataset",
        )
        DatasetServiceIntegrationDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            name="Existing Dataset",
        )

        # Act / Assert
        with pytest.raises(ValueError, match="Dataset name already exists"):
            DatasetService.update_dataset(source_dataset.id, {"name": "Existing Dataset"}, account)

    def test_delete_dataset_with_documents_success(self, db_session_with_containers):
        """Delete a dataset that already has documents."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant()
        dataset = DatasetServiceIntegrationDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            indexing_technique="high_quality",
            chunk_structure="text_model",
        )
        DatasetServiceIntegrationDataFactory.create_document(dataset=dataset, created_by=account.id)

        # Act
        with patch("services.dataset_service.dataset_was_deleted") as dataset_deleted_signal:
            result = DatasetService.delete_dataset(dataset.id, account)

        # Assert
        assert result is True
        assert db.session.get(Dataset, dataset.id) is None
        dataset_deleted_signal.send.assert_called_once_with(dataset)

    def test_delete_empty_dataset_success(self, db_session_with_containers):
        """Delete a dataset that has no documents and no indexing technique."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant()
        dataset = DatasetServiceIntegrationDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            indexing_technique=None,
            chunk_structure=None,
        )

        # Act
        with patch("services.dataset_service.dataset_was_deleted") as dataset_deleted_signal:
            result = DatasetService.delete_dataset(dataset.id, account)

        # Assert
        assert result is True
        assert db.session.get(Dataset, dataset.id) is None
        dataset_deleted_signal.send.assert_called_once_with(dataset)

    def test_delete_dataset_with_partial_none_values(self, db_session_with_containers):
        """Delete dataset when indexing_technique is None but doc_form path still exists."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant()
        dataset = DatasetServiceIntegrationDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            indexing_technique=None,
            chunk_structure="text_model",
        )

        # Act
        with patch("services.dataset_service.dataset_was_deleted") as dataset_deleted_signal:
            result = DatasetService.delete_dataset(dataset.id, account)

        # Assert
        assert result is True
        assert db.session.get(Dataset, dataset.id) is None
        dataset_deleted_signal.send.assert_called_once_with(dataset)


class TestDatasetServiceRetrievalConfiguration:
    """Integration coverage for retrieval configuration persistence."""

    def test_get_dataset_retrieval_configuration(self, db_session_with_containers):
        """Return retrieval configuration that is persisted in SQL."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant()
        retrieval_model = {
            "search_method": "semantic_search",
            "top_k": 5,
            "score_threshold": 0.5,
            "reranking_enable": True,
        }
        dataset = DatasetServiceIntegrationDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            retrieval_model=retrieval_model,
        )

        # Act
        result = DatasetService.get_dataset(dataset.id)

        # Assert
        assert result is not None
        assert result.retrieval_model == retrieval_model
        assert result.retrieval_model["search_method"] == "semantic_search"
        assert result.retrieval_model["top_k"] == 5

    def test_update_dataset_retrieval_configuration(self, db_session_with_containers):
        """Persist retrieval configuration updates through DatasetService.update_dataset."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant()
        dataset = DatasetServiceIntegrationDataFactory.create_dataset(
            tenant_id=tenant.id,
            created_by=account.id,
            indexing_technique="high_quality",
            retrieval_model={"search_method": "semantic_search", "top_k": 2, "score_threshold": 0.0},
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
            collection_binding_id=str(uuid4()),
        )
        update_data = {
            "indexing_technique": "high_quality",
            "retrieval_model": {
                "search_method": "full_text_search",
                "top_k": 10,
                "score_threshold": 0.7,
            },
        }

        # Act
        result = DatasetService.update_dataset(dataset.id, update_data, account)

        # Assert
        db.session.refresh(dataset)
        assert result.id == dataset.id
        assert dataset.retrieval_model == update_data["retrieval_model"]
