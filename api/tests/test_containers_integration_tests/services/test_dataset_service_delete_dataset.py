"""Container-backed integration tests for DatasetService.delete_dataset real SQL paths."""

from unittest.mock import patch
from uuid import uuid4

from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom
from services.dataset_service import DatasetService


class DatasetDeleteIntegrationDataFactory:
    """Create persisted entities used by delete_dataset integration tests."""

    @staticmethod
    def create_account_with_tenant(db_session_with_containers) -> tuple[Account, Tenant]:
        """Persist an owner account, tenant, and tenant join for dataset deletion tests."""
        account = Account(
            email=f"owner-{uuid4()}@example.com",
            name="Owner",
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant = Tenant(
            name=f"tenant-{uuid4()}",
            status="normal",
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        account.current_tenant = tenant
        return account, tenant

    @staticmethod
    def create_dataset(
        db_session_with_containers,
        tenant_id: str,
        created_by: str,
        *,
        indexing_technique: str | None,
        chunk_structure: str | None,
        index_struct: str | None = '{"type": "paragraph"}',
        collection_binding_id: str | None = None,
        pipeline_id: str | None = None,
    ) -> Dataset:
        """Persist a dataset with delete_dataset-relevant fields configured."""
        dataset = Dataset(
            tenant_id=tenant_id,
            name=f"dataset-{uuid4()}",
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=indexing_technique,
            index_struct=index_struct,
            created_by=created_by,
            collection_binding_id=collection_binding_id,
            pipeline_id=pipeline_id,
            chunk_structure=chunk_structure,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        return dataset

    @staticmethod
    def create_document(
        db_session_with_containers,
        *,
        tenant_id: str,
        dataset_id: str,
        created_by: str,
        doc_form: str = IndexStructureType.PARAGRAPH_INDEX,
    ) -> Document:
        """Persist a document so dataset.doc_form resolves through the real document path."""
        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch=f"batch-{uuid4()}",
            name="Document",
            created_from=DocumentCreatedFrom.WEB,
            created_by=created_by,
            doc_form=doc_form,
        )
        db_session_with_containers.add(document)
        db_session_with_containers.commit()
        return document


class TestDatasetServiceDeleteDataset:
    """Integration coverage for DatasetService.delete_dataset using testcontainers."""

    def test_delete_dataset_with_documents_success(self, db_session_with_containers: Session):
        """Delete a dataset with documents and dispatch cleanup through the real signal handler."""
        # Arrange
        owner, tenant = DatasetDeleteIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetDeleteIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            chunk_structure=None,
            index_struct='{"type": "paragraph"}',
            collection_binding_id=str(uuid4()),
            pipeline_id=str(uuid4()),
        )
        DatasetDeleteIntegrationDataFactory.create_document(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            created_by=owner.id,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )

        # Act
        with patch(
            "events.event_handlers.clean_when_dataset_deleted.clean_dataset_task.delay",
            autospec=True,
        ) as clean_dataset_delay:
            result = DatasetService.delete_dataset(dataset.id, owner)

        # Assert
        db_session_with_containers.expire_all()
        assert result is True
        assert db_session_with_containers.get(Dataset, dataset.id) is None
        clean_dataset_delay.assert_called_once_with(
            dataset.id,
            dataset.tenant_id,
            dataset.indexing_technique,
            dataset.index_struct,
            dataset.collection_binding_id,
            dataset.doc_form,
            dataset.pipeline_id,
        )

    def test_delete_empty_dataset_success(self, db_session_with_containers: Session):
        """Delete an empty dataset without scheduling cleanup when both gating fields are absent."""
        # Arrange
        owner, tenant = DatasetDeleteIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetDeleteIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            indexing_technique=None,
            chunk_structure=None,
            index_struct=None,
            collection_binding_id=None,
            pipeline_id=None,
        )

        # Act
        with patch(
            "events.event_handlers.clean_when_dataset_deleted.clean_dataset_task.delay",
            autospec=True,
        ) as clean_dataset_delay:
            result = DatasetService.delete_dataset(dataset.id, owner)

        # Assert
        db_session_with_containers.expire_all()
        assert result is True
        assert db_session_with_containers.get(Dataset, dataset.id) is None
        clean_dataset_delay.assert_not_called()

    def test_delete_dataset_with_partial_none_values(self, db_session_with_containers: Session):
        """Delete a dataset without cleanup when indexing_technique is missing but doc_form resolves."""
        # Arrange
        owner, tenant = DatasetDeleteIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetDeleteIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            indexing_technique=None,
            chunk_structure="text_model",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=str(uuid4()),
            pipeline_id=str(uuid4()),
        )

        # Act
        with patch(
            "events.event_handlers.clean_when_dataset_deleted.clean_dataset_task.delay",
            autospec=True,
        ) as clean_dataset_delay:
            result = DatasetService.delete_dataset(dataset.id, owner)

        # Assert
        db_session_with_containers.expire_all()
        assert result is True
        assert db_session_with_containers.get(Dataset, dataset.id) is None
        clean_dataset_delay.assert_not_called()

    def test_delete_dataset_with_doc_form_none_indexing_technique_exists(self, db_session_with_containers: Session):
        """Delete a dataset without cleanup when indexing exists but doc_form resolves to None."""
        # Arrange
        owner, tenant = DatasetDeleteIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DatasetDeleteIntegrationDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=owner.id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            chunk_structure=None,
            index_struct='{"type": "paragraph"}',
            collection_binding_id=str(uuid4()),
            pipeline_id=str(uuid4()),
        )

        # Act
        with patch(
            "events.event_handlers.clean_when_dataset_deleted.clean_dataset_task.delay",
            autospec=True,
        ) as clean_dataset_delay:
            result = DatasetService.delete_dataset(dataset.id, owner)

        # Assert
        db_session_with_containers.expire_all()
        assert result is True
        assert db_session_with_containers.get(Dataset, dataset.id) is None
        clean_dataset_delay.assert_not_called()

    def test_delete_dataset_not_found(self, db_session_with_containers: Session):
        """Return False without scheduling cleanup when the target dataset does not exist."""
        # Arrange
        owner, _ = DatasetDeleteIntegrationDataFactory.create_account_with_tenant(db_session_with_containers)
        missing_dataset_id = str(uuid4())

        # Act
        with patch(
            "events.event_handlers.clean_when_dataset_deleted.clean_dataset_task.delay",
            autospec=True,
        ) as clean_dataset_delay:
            result = DatasetService.delete_dataset(missing_dataset_id, owner)

        # Assert
        assert result is False
        clean_dataset_delay.assert_not_called()
