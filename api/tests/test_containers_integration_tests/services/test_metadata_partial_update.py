from __future__ import annotations

from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dataset import Dataset, DatasetMetadataBinding, Document
from models.enums import DataSourceType, DocumentCreatedFrom
from services.entities.knowledge_entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataDetail,
    MetadataOperationData,
)
from services.metadata_service import MetadataService


def _create_dataset(db_session, *, tenant_id: str, built_in_field_enabled: bool = False) -> Dataset:
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


def _create_document(db_session, *, dataset_id: str, tenant_id: str, doc_metadata: dict | None = None) -> Document:
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


class TestMetadataPartialUpdate:
    @pytest.fixture
    def tenant_id(self) -> str:
        return str(uuid4())

    @pytest.fixture
    def user_id(self) -> str:
        return str(uuid4())

    @pytest.fixture
    def mock_current_account(self, user_id, tenant_id):
        account = Mock(id=user_id, current_tenant_id=tenant_id)
        with patch("services.metadata_service.current_account_with_tenant", return_value=(account, tenant_id)):
            yield account

    def test_partial_update_merges_metadata(
        self, flask_app_with_containers, db_session_with_containers: Session, tenant_id, mock_current_account
    ):
        dataset = _create_dataset(db_session_with_containers, tenant_id=tenant_id)
        document = _create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            doc_metadata={"existing_key": "existing_value"},
        )

        meta_id = str(uuid4())
        operation = DocumentMetadataOperation(
            document_id=document.id,
            metadata_list=[MetadataDetail(id=meta_id, name="new_key", value="new_value")],
            partial_update=True,
        )
        metadata_args = MetadataOperationData(operation_data=[operation])

        MetadataService.update_documents_metadata(dataset, metadata_args)
        db_session_with_containers.expire_all()

        updated_doc = db_session_with_containers.get(Document, document.id)
        assert updated_doc is not None
        assert updated_doc.doc_metadata["existing_key"] == "existing_value"
        assert updated_doc.doc_metadata["new_key"] == "new_value"

    def test_full_update_replaces_metadata(
        self, flask_app_with_containers, db_session_with_containers: Session, tenant_id, mock_current_account
    ):
        dataset = _create_dataset(db_session_with_containers, tenant_id=tenant_id)
        document = _create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            doc_metadata={"existing_key": "existing_value"},
        )

        meta_id = str(uuid4())
        operation = DocumentMetadataOperation(
            document_id=document.id,
            metadata_list=[MetadataDetail(id=meta_id, name="new_key", value="new_value")],
            partial_update=False,
        )
        metadata_args = MetadataOperationData(operation_data=[operation])

        MetadataService.update_documents_metadata(dataset, metadata_args)
        db_session_with_containers.expire_all()

        updated_doc = db_session_with_containers.get(Document, document.id)
        assert updated_doc is not None
        assert updated_doc.doc_metadata == {"new_key": "new_value"}
        assert "existing_key" not in updated_doc.doc_metadata

    def test_partial_update_skips_existing_binding(
        self, flask_app_with_containers, db_session_with_containers: Session, tenant_id, user_id, mock_current_account
    ):
        dataset = _create_dataset(db_session_with_containers, tenant_id=tenant_id)
        document = _create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            doc_metadata={"existing_key": "existing_value"},
        )

        meta_id = str(uuid4())
        existing_binding = DatasetMetadataBinding(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            metadata_id=meta_id,
            created_by=user_id,
        )
        db_session_with_containers.add(existing_binding)
        db_session_with_containers.commit()

        operation = DocumentMetadataOperation(
            document_id=document.id,
            metadata_list=[MetadataDetail(id=meta_id, name="existing_key", value="existing_value")],
            partial_update=True,
        )
        metadata_args = MetadataOperationData(operation_data=[operation])

        MetadataService.update_documents_metadata(dataset, metadata_args)
        db_session_with_containers.expire_all()

        bindings = db_session_with_containers.scalars(
            select(DatasetMetadataBinding).where(
                DatasetMetadataBinding.document_id == document.id,
                DatasetMetadataBinding.metadata_id == meta_id,
            )
        ).all()
        assert len(bindings) == 1

    def test_rollback_called_on_commit_failure(
        self, flask_app_with_containers, db_session_with_containers: Session, tenant_id, mock_current_account
    ):
        dataset = _create_dataset(db_session_with_containers, tenant_id=tenant_id)
        document = _create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            doc_metadata={"existing_key": "existing_value"},
        )

        meta_id = str(uuid4())
        operation = DocumentMetadataOperation(
            document_id=document.id,
            metadata_list=[MetadataDetail(id=meta_id, name="key", value="value")],
            partial_update=True,
        )
        metadata_args = MetadataOperationData(operation_data=[operation])

        with patch("services.metadata_service.db.session.commit", side_effect=RuntimeError("database connection lost")):
            with pytest.raises(RuntimeError, match="database connection lost"):
                MetadataService.update_documents_metadata(dataset, metadata_args)
