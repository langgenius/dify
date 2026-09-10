from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from models import Account, Tenant
from models.dataset import Dataset, DatasetMetadata, DatasetMetadataBinding, Document
from models.enums import DatasetMetadataType, DataSourceType, DocumentCreatedFrom
from services.entities.knowledge_entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataDetail,
    MetadataOperationData,
)
from services.metadata_service import MetadataService


def _create_dataset(db_session: Session, *, tenant_id: str, built_in_field_enabled: bool = False) -> Dataset:
    dataset = Dataset(
        tenant_id=tenant_id,
        name=f"dataset-{uuid4()}",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=str(uuid4()),
    )
    dataset.id = str(uuid4())
    dataset.built_in_field_enabled = built_in_field_enabled
    db_session.add(dataset)
    db_session.commit()
    return dataset


def _create_document(
    db_session: Session, *, dataset_id: str, tenant_id: str, doc_metadata: dict[str, str] | None = None
) -> Document:
    document = Document(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch=f"batch-{uuid4()}",
        name=f"doc-{uuid4()}",
        created_from=DocumentCreatedFrom.WEB,
        created_by=str(uuid4()),
    )
    document.id = str(uuid4())
    document.doc_metadata = doc_metadata
    db_session.add(document)
    db_session.commit()
    return document


def _create_metadata(db_session: Session, *, dataset: Dataset, created_by: str, name: str) -> DatasetMetadata:
    metadata = DatasetMetadata(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        type=DatasetMetadataType.STRING,
        name=name,
        created_by=created_by,
    )
    db_session.add(metadata)
    db_session.commit()
    return metadata


class TestMetadataPartialUpdate:
    @pytest.fixture
    def tenant_id(self) -> str:
        return str(uuid4())

    @pytest.fixture
    def user_id(self) -> str:
        return str(uuid4())

    @pytest.fixture
    def current_account(self, user_id: str, tenant_id: str) -> Account:
        account = Account(name="Test User", email=f"{user_id}@example.com")
        account.id = user_id
        tenant = Tenant(name="Test Tenant")
        tenant.id = tenant_id
        account._current_tenant = tenant
        return account

    def test_partial_update_merges_metadata(
        self,
        flask_app_with_containers: Flask,
        db_session_with_containers: Session,
        tenant_id: str,
        current_account: Account,
    ) -> None:
        dataset = _create_dataset(db_session_with_containers, tenant_id=tenant_id)
        document = _create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            doc_metadata={"existing_key": "existing_value"},
        )

        metadata = _create_metadata(
            db_session_with_containers, dataset=dataset, created_by=current_account.id, name="new_key"
        )
        operation = DocumentMetadataOperation(
            document_id=document.id,
            metadata_list=[MetadataDetail(id=metadata.id, name=metadata.name, value="new_value")],
            partial_update=True,
        )
        metadata_args = MetadataOperationData(operation_data=[operation])

        MetadataService.update_documents_metadata(
            dataset, metadata_args, current_account, session=db_session_with_containers
        )
        db_session_with_containers.expire_all()

        updated_doc = db_session_with_containers.get(Document, document.id)
        assert updated_doc is not None
        assert updated_doc.doc_metadata["existing_key"] == "existing_value"
        assert updated_doc.doc_metadata["new_key"] == "new_value"

    def test_concurrent_partial_updates_keep_both_values(
        self,
        db_session_with_containers: Session,
        tenant_id: str,
        current_account: Account,
    ) -> None:
        dataset = _create_dataset(db_session_with_containers, tenant_id=tenant_id)
        document = _create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            doc_metadata={},
        )
        metadatas = [
            _create_metadata(
                db_session_with_containers,
                dataset=dataset,
                created_by=current_account.id,
                name=name,
            )
            for name in ("author", "region")
        ]
        operations = [
            MetadataOperationData(
                operation_data=[
                    DocumentMetadataOperation(
                        document_id=document.id,
                        metadata_list=[MetadataDetail(id=metadata.id, name=metadata.name, value=value)],
                        partial_update=True,
                    )
                ]
            )
            for metadata, value in zip(metadatas, ("Alice", "EU"), strict=True)
        ]
        dataset_id = dataset.id
        document_id = document.id
        session_factory = sessionmaker(bind=db_session_with_containers.get_bind())
        engine = db_session_with_containers.get_bind()
        locked_select_barrier = Barrier(2)
        locked_selects: list[None] = []

        def synchronize_locked_select(
            _conn: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: bool,
        ) -> None:
            if "FROM documents" in statement and "FOR UPDATE" in statement:
                locked_selects.append(None)
                locked_select_barrier.wait(timeout=10)

        def update(metadata_args: MetadataOperationData) -> None:
            with session_factory() as session:
                owned_dataset = session.get(Dataset, dataset_id)
                assert owned_dataset is not None
                MetadataService.update_documents_metadata(
                    owned_dataset, metadata_args, current_account, session=session
                )

        event.listen(engine, "before_cursor_execute", synchronize_locked_select)
        try:
            with (
                patch.object(MetadataService, "knowledge_base_metadata_lock_check"),
                patch("services.metadata_service.redis_client.delete"),
                ThreadPoolExecutor(max_workers=2) as executor,
            ):
                futures = [executor.submit(update, operation) for operation in operations]
                for future in futures:
                    future.result(timeout=20)
        finally:
            event.remove(engine, "before_cursor_execute", synchronize_locked_select)

        db_session_with_containers.expire_all()
        updated_doc = db_session_with_containers.get(Document, document_id)
        assert updated_doc is not None
        assert len(locked_selects) == 2
        assert updated_doc.doc_metadata == {"author": "Alice", "region": "EU"}

    def test_full_update_replaces_metadata(
        self,
        flask_app_with_containers: Flask,
        db_session_with_containers: Session,
        tenant_id: str,
        current_account: Account,
    ) -> None:
        dataset = _create_dataset(db_session_with_containers, tenant_id=tenant_id)
        document = _create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            doc_metadata={"existing_key": "existing_value"},
        )

        metadata = _create_metadata(
            db_session_with_containers, dataset=dataset, created_by=current_account.id, name="new_key"
        )
        operation = DocumentMetadataOperation(
            document_id=document.id,
            metadata_list=[MetadataDetail(id=metadata.id, name=metadata.name, value="new_value")],
            partial_update=False,
        )
        metadata_args = MetadataOperationData(operation_data=[operation])

        MetadataService.update_documents_metadata(
            dataset, metadata_args, current_account, session=db_session_with_containers
        )
        db_session_with_containers.expire_all()

        updated_doc = db_session_with_containers.get(Document, document.id)
        assert updated_doc is not None
        assert updated_doc.doc_metadata == {"new_key": "new_value"}
        assert "existing_key" not in updated_doc.doc_metadata

    def test_partial_update_skips_existing_binding(
        self,
        flask_app_with_containers: Flask,
        db_session_with_containers: Session,
        tenant_id: str,
        user_id: str,
        current_account: Account,
    ) -> None:
        dataset = _create_dataset(db_session_with_containers, tenant_id=tenant_id)
        document = _create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            doc_metadata={"existing_key": "existing_value"},
        )

        metadata = _create_metadata(
            db_session_with_containers, dataset=dataset, created_by=current_account.id, name="existing_key"
        )
        existing_binding = DatasetMetadataBinding(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            metadata_id=metadata.id,
            created_by=user_id,
        )
        db_session_with_containers.add(existing_binding)
        db_session_with_containers.commit()

        operation = DocumentMetadataOperation(
            document_id=document.id,
            metadata_list=[MetadataDetail(id=metadata.id, name=metadata.name, value="existing_value")],
            partial_update=True,
        )
        metadata_args = MetadataOperationData(operation_data=[operation])

        MetadataService.update_documents_metadata(
            dataset, metadata_args, current_account, session=db_session_with_containers
        )
        db_session_with_containers.expire_all()

        bindings = db_session_with_containers.scalars(
            select(DatasetMetadataBinding).where(
                DatasetMetadataBinding.document_id == document.id,
                DatasetMetadataBinding.metadata_id == metadata.id,
            )
        ).all()
        assert len(bindings) == 1

    def test_rollback_called_on_commit_failure(
        self,
        flask_app_with_containers: Flask,
        db_session_with_containers: Session,
        tenant_id: str,
        current_account: Account,
    ) -> None:
        dataset = _create_dataset(db_session_with_containers, tenant_id=tenant_id)
        document = _create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            doc_metadata={"existing_key": "existing_value"},
        )

        metadata = _create_metadata(
            db_session_with_containers, dataset=dataset, created_by=current_account.id, name="key"
        )
        operation = DocumentMetadataOperation(
            document_id=document.id,
            metadata_list=[MetadataDetail(id=metadata.id, name=metadata.name, value="value")],
            partial_update=True,
        )
        metadata_args = MetadataOperationData(operation_data=[operation])

        with patch.object(db_session_with_containers, "commit", side_effect=RuntimeError("database connection lost")):
            with pytest.raises(RuntimeError, match="database connection lost"):
                MetadataService.update_documents_metadata(
                    dataset, metadata_args, current_account, session=db_session_with_containers
                )
