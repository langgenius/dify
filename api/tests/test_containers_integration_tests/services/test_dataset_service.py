"""Integration tests for SQL-oriented DatasetService scenarios.

This suite migrates SQL-backed behaviors from the old unit suite to real
container-backed integration tests. The tests exercise real ORM persistence and
only patch non-DB collaborators when needed.
"""

from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from dify_graph.model_runtime.entities.model_entities import ModelType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, DatasetPermissionEnum, Document, ExternalKnowledgeBindings, Pipeline
from models.enums import DatasetRuntimeMode, DataSourceType, DocumentCreatedFrom, IndexingStatus
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.knowledge_entities import RerankingModel, RetrievalModel
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, RagPipelineDatasetCreateEntity
from services.errors.dataset import DatasetNameDuplicateError


class DatasetServiceIntegrationDataFactory:
    """Factory for creating real database entities used by integration tests."""

    @staticmethod
    def create_account_with_tenant(
        db_session_with_containers: Session, role: TenantAccountRole = TenantAccountRole.OWNER
    ) -> tuple[Account, Tenant]:
        """Create an account and tenant, then bind the account as current tenant member."""
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status="active",
        )
        tenant = Tenant(name=f"tenant-{uuid4()}", status="normal")
        db_session_with_containers.add_all([account, tenant])
        db_session_with_containers.flush()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=role,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.flush()

        # Keep tenant context on the in-memory user without opening a separate session.
        account.role = role
        account._current_tenant = tenant
        return account, tenant

    @staticmethod
    def create_dataset(
        db_session_with_containers: Session,
        tenant_id: str,
        created_by: str,
        name: str = "Test Dataset",
        description: str | None = "Test description",
        provider: str = "vendor",
        indexing_technique: str | None = IndexTechniqueType.HIGH_QUALITY,
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
            data_source_type=DataSourceType.UPLOAD_FILE,
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
        db_session_with_containers.add(dataset)
        db_session_with_containers.flush()
        return dataset

    @staticmethod
    def create_document(
        db_session_with_containers: Session, dataset: Dataset, created_by: str, name: str = "doc.txt"
    ) -> Document:
        """Create a document row belonging to the given dataset."""
        document = Document(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info='{"upload_file_id": "upload-file-id"}',
            batch=str(uuid4()),
            name=name,
            created_from=DocumentCreatedFrom.WEB,
            created_by=created_by,
            indexing_status=IndexingStatus.COMPLETED,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        db_session_with_containers.add(document)
        db_session_with_containers.flush()
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

    def test_create_internal_dataset_basic_success(self, db_session_with_containers: Session):
        """Create a basic internal dataset with minimal configuration."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)

        # Act
        result = DatasetService.create_empty_dataset(
            tenant_id=tenant.id,
            name="Basic Internal Dataset",
            description="Test description",
            indexing_technique=None,
            account=account,
        )

        # Assert
        created_dataset = db_session_with_containers.get(Dataset, result.id)
        assert created_dataset is not None
        assert created_dataset.provider == "vendor"
        assert created_dataset.permission == DatasetPermissionEnum.ONLY_ME
        assert created_dataset.embedding_model_provider is None
        assert created_dataset.embedding_model is None

    def test_create_internal_dataset_with_economy_indexing(self, db_session_with_containers: Session):
        """Create an internal dataset with economy indexing and no embedding model."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)

        # Act
        result = DatasetService.create_empty_dataset(
            tenant_id=tenant.id,
            name="Economy Dataset",
            description=None,
            indexing_technique=IndexTechniqueType.ECONOMY,
            account=account,
        )

        # Assert
        db_session_with_containers.refresh(result)
        assert result.indexing_technique == IndexTechniqueType.ECONOMY
        assert result.embedding_model_provider is None
        assert result.embedding_model is None

    def test_create_internal_dataset_with_high_quality_indexing(self, db_session_with_containers: Session):
        """Create a high-quality dataset and persist embedding model settings."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        embedding_model = DatasetServiceIntegrationDataFactory.create_embedding_model()

        # Act
        with patch("services.dataset_service.ModelManager") as mock_model_manager:
            mock_model_manager.return_value.get_default_model_instance.return_value = embedding_model

            result = DatasetService.create_empty_dataset(
                tenant_id=tenant.id,
                name="High Quality Dataset",
                description=None,
                indexing_technique=IndexTechniqueType.HIGH_QUALITY,
                account=account,
            )

        # Assert
        db_session_with_containers.refresh(result)
        assert result.indexing_technique == IndexTechniqueType.HIGH_QUALITY
        assert result.embedding_model_provider == embedding_model.provider
        assert result.embedding_model == embedding_model.model_name
        mock_model_manager.return_value.get_default_model_instance.assert_called_once_with(
            tenant_id=tenant.id,
            model_type=ModelType.TEXT_EMBEDDING,
        )

    def test_create_dataset_duplicate_name_error(self, db_session_with_containers: Session):
        """Raise duplicate-name error when the same tenant already has the name."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        DatasetServiceIntegrationDataFactory.create_dataset(
            db_session_with_containers,
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

    def test_create_external_dataset_success(self, db_session_with_containers: Session):
        """Create an external dataset and persist external knowledge binding."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
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
        binding = db_session_with_containers.query(ExternalKnowledgeBindings).filter_by(dataset_id=result.id).first()
        assert result.provider == "external"
        assert binding is not None
        assert binding.external_knowledge_id == external_knowledge_id
        assert binding.external_knowledge_api_id == external_knowledge_api_id

    def test_create_dataset_with_retrieval_model_and_reranking(self, db_session_with_containers: Session):
        """Create a high-quality dataset with retrieval/reranking settings."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
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
                indexing_technique=IndexTechniqueType.HIGH_QUALITY,
                account=account,
                retrieval_model=retrieval_model,
            )

        # Assert
        db_session_with_containers.refresh(result)
        assert result.retrieval_model == retrieval_model.model_dump()
        mock_check_reranking.assert_called_once_with(tenant.id, "cohere", "rerank-english-v2.0")

    def test_create_internal_dataset_with_high_quality_indexing_custom_embedding(
        self, db_session_with_containers: Session
    ):
        """Create high-quality dataset with explicitly configured embedding model."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        embedding_provider = "openai"
        embedding_model_name = "text-embedding-3-small"
        embedding_model = DatasetServiceIntegrationDataFactory.create_embedding_model(
            provider=embedding_provider, model_name=embedding_model_name
        )

        # Act
        with (
            patch("services.dataset_service.ModelManager") as mock_model_manager,
            patch("services.dataset_service.DatasetService.check_embedding_model_setting") as mock_check_embedding,
        ):
            mock_model_manager.return_value.get_model_instance.return_value = embedding_model

            result = DatasetService.create_empty_dataset(
                tenant_id=tenant.id,
                name="Custom Embedding Dataset",
                description=None,
                indexing_technique=IndexTechniqueType.HIGH_QUALITY,
                account=account,
                embedding_model_provider=embedding_provider,
                embedding_model_name=embedding_model_name,
            )

        # Assert
        db_session_with_containers.refresh(result)
        assert result.indexing_technique == IndexTechniqueType.HIGH_QUALITY
        assert result.embedding_model_provider == embedding_provider
        assert result.embedding_model == embedding_model_name
        mock_check_embedding.assert_called_once_with(tenant.id, embedding_provider, embedding_model_name)
        mock_model_manager.return_value.get_model_instance.assert_called_once_with(
            tenant_id=tenant.id,
            provider=embedding_provider,
            model_type=ModelType.TEXT_EMBEDDING,
            model=embedding_model_name,
        )

    def test_create_internal_dataset_with_retrieval_model(self, db_session_with_containers: Session):
        """Persist retrieval model settings when creating an internal dataset."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        retrieval_model = RetrievalModel(
            search_method=RetrievalMethod.SEMANTIC_SEARCH,
            reranking_enable=False,
            top_k=2,
            score_threshold_enabled=True,
            score_threshold=0.0,
        )

        # Act
        result = DatasetService.create_empty_dataset(
            tenant_id=tenant.id,
            name="Retrieval Model Dataset",
            description=None,
            indexing_technique=None,
            account=account,
            retrieval_model=retrieval_model,
        )

        # Assert
        db_session_with_containers.refresh(result)
        assert result.retrieval_model == retrieval_model.model_dump()

    def test_create_internal_dataset_with_custom_permission(self, db_session_with_containers: Session):
        """Persist canonical custom permission when creating an internal dataset."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)

        # Act
        result = DatasetService.create_empty_dataset(
            tenant_id=tenant.id,
            name="Custom Permission Dataset",
            description=None,
            indexing_technique=None,
            account=account,
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        # Assert
        db_session_with_containers.refresh(result)
        assert result.permission == DatasetPermissionEnum.ALL_TEAM

    def test_create_external_dataset_missing_api_id_error(self, db_session_with_containers: Session):
        """Raise error when external API template does not exist."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        external_knowledge_api_id = str(uuid4())

        # Act / Assert
        with patch("services.dataset_service.ExternalDatasetService.get_external_knowledge_api") as mock_get_api:
            mock_get_api.return_value = None
            with pytest.raises(ValueError, match=r"External API template not found\.?"):
                DatasetService.create_empty_dataset(
                    tenant_id=tenant.id,
                    name="External Missing API Dataset",
                    description=None,
                    indexing_technique=None,
                    account=account,
                    provider="external",
                    external_knowledge_api_id=external_knowledge_api_id,
                    external_knowledge_id="knowledge-123",
                )

    def test_create_external_dataset_missing_knowledge_id_error(self, db_session_with_containers: Session):
        """Raise error when external knowledge id is missing for external dataset creation."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        external_knowledge_api_id = str(uuid4())

        # Act / Assert
        with patch("services.dataset_service.ExternalDatasetService.get_external_knowledge_api") as mock_get_api:
            mock_get_api.return_value = Mock(id=external_knowledge_api_id)
            with pytest.raises(ValueError, match="external_knowledge_id is required"):
                DatasetService.create_empty_dataset(
                    tenant_id=tenant.id,
                    name="External Missing Knowledge Dataset",
                    description=None,
                    indexing_technique=None,
                    account=account,
                    provider="external",
                    external_knowledge_api_id=external_knowledge_api_id,
                    external_knowledge_id=None,
                )


class TestDatasetServiceCreateRagPipelineDataset:
    """Integration coverage for DatasetService.create_empty_rag_pipeline_dataset."""

    def test_create_rag_pipeline_dataset_with_name_success(self, db_session_with_containers: Session):
        """Create rag-pipeline dataset and pipeline rows when a name is provided."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        icon_info = IconInfo(icon="📙", icon_background="#FFF4ED", icon_type="emoji")
        entity = RagPipelineDatasetCreateEntity(
            name="RAG Pipeline Dataset",
            description="RAG Pipeline Description",
            icon_info=icon_info,
            permission=DatasetPermissionEnum.ONLY_ME,
        )

        # Act
        with patch("services.dataset_service.current_user", account):
            result = DatasetService.create_empty_rag_pipeline_dataset(
                tenant_id=tenant.id, rag_pipeline_dataset_create_entity=entity
            )

        # Assert
        created_dataset = db_session_with_containers.get(Dataset, result.id)
        created_pipeline = db_session_with_containers.get(Pipeline, result.pipeline_id)
        assert created_dataset is not None
        assert created_dataset.name == entity.name
        assert created_dataset.runtime_mode == DatasetRuntimeMode.RAG_PIPELINE
        assert created_dataset.created_by == account.id
        assert created_dataset.permission == DatasetPermissionEnum.ONLY_ME
        assert created_pipeline is not None
        assert created_pipeline.name == entity.name
        assert created_pipeline.created_by == account.id

    def test_create_rag_pipeline_dataset_with_auto_generated_name(self, db_session_with_containers: Session):
        """Create rag-pipeline dataset with generated incremental name when input name is empty."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        generated_name = "Untitled 1"
        icon_info = IconInfo(icon="📙", icon_background="#FFF4ED", icon_type="emoji")
        entity = RagPipelineDatasetCreateEntity(
            name="",
            description="",
            icon_info=icon_info,
            permission=DatasetPermissionEnum.ONLY_ME,
        )

        # Act
        with (
            patch("services.dataset_service.current_user", account),
            patch("services.dataset_service.generate_incremental_name") as mock_generate_name,
        ):
            mock_generate_name.return_value = generated_name
            result = DatasetService.create_empty_rag_pipeline_dataset(
                tenant_id=tenant.id, rag_pipeline_dataset_create_entity=entity
            )

        # Assert
        db_session_with_containers.refresh(result)
        created_pipeline = db_session_with_containers.get(Pipeline, result.pipeline_id)
        assert result.name == generated_name
        assert created_pipeline is not None
        assert created_pipeline.name == generated_name
        mock_generate_name.assert_called_once()

    def test_create_rag_pipeline_dataset_duplicate_name_error(self, db_session_with_containers: Session):
        """Raise duplicate-name error when rag-pipeline dataset name already exists."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        duplicate_name = "Duplicate RAG Dataset"
        DatasetServiceIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=account.id,
            name=duplicate_name,
            indexing_technique=None,
        )
        db_session_with_containers.commit()
        icon_info = IconInfo(icon="📙", icon_background="#FFF4ED", icon_type="emoji")
        entity = RagPipelineDatasetCreateEntity(
            name=duplicate_name,
            description="",
            icon_info=icon_info,
            permission=DatasetPermissionEnum.ONLY_ME,
        )

        # Act / Assert
        with (
            patch("services.dataset_service.current_user", account),
            pytest.raises(DatasetNameDuplicateError, match=f"Dataset with name {duplicate_name} already exists"),
        ):
            DatasetService.create_empty_rag_pipeline_dataset(
                tenant_id=tenant.id, rag_pipeline_dataset_create_entity=entity
            )

    def test_create_rag_pipeline_dataset_with_custom_permission(self, db_session_with_containers: Session):
        """Persist canonical custom permission for rag-pipeline dataset creation."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        icon_info = IconInfo(icon="📙", icon_background="#FFF4ED", icon_type="emoji")
        entity = RagPipelineDatasetCreateEntity(
            name="Custom Permission RAG Dataset",
            description="",
            icon_info=icon_info,
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        # Act
        with patch("services.dataset_service.current_user", account):
            result = DatasetService.create_empty_rag_pipeline_dataset(
                tenant_id=tenant.id, rag_pipeline_dataset_create_entity=entity
            )

        # Assert
        db_session_with_containers.refresh(result)
        assert result.permission == DatasetPermissionEnum.ALL_TEAM

    def test_create_rag_pipeline_dataset_with_icon_info(self, db_session_with_containers: Session):
        """Persist icon metadata when creating rag-pipeline dataset."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        icon_info = IconInfo(
            icon="📚",
            icon_background="#E8F5E9",
            icon_type="emoji",
            icon_url="https://example.com/icon.png",
        )
        entity = RagPipelineDatasetCreateEntity(
            name="Icon Info RAG Dataset",
            description="",
            icon_info=icon_info,
            permission=DatasetPermissionEnum.ONLY_ME,
        )

        # Act
        with patch("services.dataset_service.current_user", account):
            result = DatasetService.create_empty_rag_pipeline_dataset(
                tenant_id=tenant.id, rag_pipeline_dataset_create_entity=entity
            )

        # Assert
        db_session_with_containers.refresh(result)
        assert result.icon_info == icon_info.model_dump()


class TestDatasetServiceUpdateAndDeleteDataset:
    """Integration coverage for SQL-backed update and delete behavior."""

    def test_update_dataset_duplicate_name_error(self, db_session_with_containers: Session):
        """Reject update when target name already exists within the same tenant."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        source_dataset = DatasetServiceIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=account.id,
            name="Source Dataset",
        )
        DatasetServiceIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=account.id,
            name="Existing Dataset",
        )

        # Act / Assert
        with pytest.raises(ValueError, match="Dataset name already exists"):
            DatasetService.update_dataset(source_dataset.id, {"name": "Existing Dataset"}, account)

    def test_delete_dataset_with_documents_success(self, db_session_with_containers: Session):
        """Delete a dataset that already has documents."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetServiceIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=account.id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            chunk_structure="text_model",
        )
        DatasetServiceIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, created_by=account.id
        )

        # Act
        with patch("services.dataset_service.dataset_was_deleted") as dataset_deleted_signal:
            result = DatasetService.delete_dataset(dataset.id, account)

        # Assert
        assert result is True
        assert db_session_with_containers.get(Dataset, dataset.id) is None
        dataset_deleted_signal.send.assert_called_once_with(dataset)

    def test_delete_empty_dataset_success(self, db_session_with_containers: Session):
        """Delete a dataset that has no documents and no indexing technique."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetServiceIntegrationDataFactory.create_dataset(
            db_session_with_containers,
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
        assert db_session_with_containers.get(Dataset, dataset.id) is None
        dataset_deleted_signal.send.assert_called_once_with(dataset)

    def test_delete_dataset_with_partial_none_values(self, db_session_with_containers: Session):
        """Delete dataset when indexing_technique is None but doc_form path still exists."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetServiceIntegrationDataFactory.create_dataset(
            db_session_with_containers,
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
        assert db_session_with_containers.get(Dataset, dataset.id) is None
        dataset_deleted_signal.send.assert_called_once_with(dataset)


class TestDatasetServiceRetrievalConfiguration:
    """Integration coverage for retrieval configuration persistence."""

    def test_get_dataset_retrieval_configuration(self, db_session_with_containers: Session):
        """Return retrieval configuration that is persisted in SQL."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        retrieval_model = {
            "search_method": "semantic_search",
            "top_k": 5,
            "score_threshold": 0.5,
            "reranking_enable": True,
        }
        dataset = DatasetServiceIntegrationDataFactory.create_dataset(
            db_session_with_containers,
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

    def test_update_dataset_retrieval_configuration(self, db_session_with_containers: Session):
        """Persist retrieval configuration updates through DatasetService.update_dataset."""
        # Arrange
        account, tenant = DatasetServiceIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetServiceIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=account.id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            retrieval_model={"search_method": "semantic_search", "top_k": 2, "score_threshold": 0.0},
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
            collection_binding_id=str(uuid4()),
        )
        update_data = {
            "indexing_technique": IndexTechniqueType.HIGH_QUALITY,
            "retrieval_model": {
                "search_method": "full_text_search",
                "top_k": 10,
                "score_threshold": 0.7,
            },
        }

        # Act
        result = DatasetService.update_dataset(dataset.id, update_data, account)

        # Assert
        db_session_with_containers.refresh(dataset)
        assert result.id == dataset.id
        assert dataset.retrieval_model == update_data["retrieval_model"]


class TestDocumentServicePauseRecoverRetry:
    """Tests for pause/recover/retry orchestration using real DB and Redis."""

    def _create_indexing_document(self, db_session_with_containers, indexing_status="indexing"):
        factory = DatasetServiceIntegrationDataFactory
        account, tenant = factory.create_account_with_tenant(db_session_with_containers)
        dataset = factory.create_dataset(db_session_with_containers, tenant.id, account.id)
        doc = factory.create_document(db_session_with_containers, dataset, account.id)
        doc.indexing_status = indexing_status
        db_session_with_containers.commit()
        return doc, account

    def test_pause_document_success(self, db_session_with_containers):
        from extensions.ext_redis import redis_client
        from services.dataset_service import DocumentService

        doc, account = self._create_indexing_document(db_session_with_containers, indexing_status="indexing")

        with patch("services.dataset_service.current_user") as mock_user:
            mock_user.id = account.id
            DocumentService.pause_document(doc)

        db_session_with_containers.refresh(doc)
        assert doc.is_paused is True
        assert doc.paused_by == account.id
        assert doc.paused_at is not None

        cache_key = f"document_{doc.id}_is_paused"
        assert redis_client.get(cache_key) is not None
        redis_client.delete(cache_key)

    def test_pause_document_invalid_status_error(self, db_session_with_containers):
        from services.dataset_service import DocumentService
        from services.errors.document import DocumentIndexingError

        doc, account = self._create_indexing_document(db_session_with_containers, indexing_status="completed")

        with patch("services.dataset_service.current_user") as mock_user:
            mock_user.id = account.id
            with pytest.raises(DocumentIndexingError):
                DocumentService.pause_document(doc)

    def test_recover_document_success(self, db_session_with_containers):
        from extensions.ext_redis import redis_client
        from services.dataset_service import DocumentService

        doc, account = self._create_indexing_document(db_session_with_containers, indexing_status="indexing")

        # Pause first
        with patch("services.dataset_service.current_user") as mock_user:
            mock_user.id = account.id
            DocumentService.pause_document(doc)

        # Recover
        with patch("services.dataset_service.recover_document_indexing_task") as recover_task:
            DocumentService.recover_document(doc)

        db_session_with_containers.refresh(doc)
        assert doc.is_paused is False
        assert doc.paused_by is None
        assert doc.paused_at is None

        cache_key = f"document_{doc.id}_is_paused"
        assert redis_client.get(cache_key) is None
        recover_task.delay.assert_called_once_with(doc.dataset_id, doc.id)

    def test_retry_document_indexing_success(self, db_session_with_containers):
        from extensions.ext_redis import redis_client
        from services.dataset_service import DocumentService

        factory = DatasetServiceIntegrationDataFactory
        account, tenant = factory.create_account_with_tenant(db_session_with_containers)
        dataset = factory.create_dataset(db_session_with_containers, tenant.id, account.id)
        doc1 = factory.create_document(db_session_with_containers, dataset, account.id, name="doc1.txt")
        doc2 = factory.create_document(db_session_with_containers, dataset, account.id, name="doc2.txt")
        doc2.position = 2
        doc1.indexing_status = "error"
        doc2.indexing_status = "error"
        db_session_with_containers.commit()

        with (
            patch("services.dataset_service.current_user") as mock_user,
            patch("services.dataset_service.retry_document_indexing_task") as retry_task,
        ):
            mock_user.id = account.id
            DocumentService.retry_document(dataset.id, [doc1, doc2])

        db_session_with_containers.refresh(doc1)
        db_session_with_containers.refresh(doc2)
        assert doc1.indexing_status == "waiting"
        assert doc2.indexing_status == "waiting"

        # Verify redis keys were set
        assert redis_client.get(f"document_{doc1.id}_is_retried") is not None
        assert redis_client.get(f"document_{doc2.id}_is_retried") is not None
        retry_task.delay.assert_called_once_with(dataset.id, [doc1.id, doc2.id], account.id)

        # Cleanup
        redis_client.delete(f"document_{doc1.id}_is_retried", f"document_{doc2.id}_is_retried")
