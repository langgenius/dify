from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.built_in_field import BuiltInField
from models import Account
from models.dataset import Dataset, DatasetMetadata, DatasetMetadataBinding, Document
from models.enums import DataSourceType, DocumentCreatedFrom
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataArgs,
    MetadataDetail,
    MetadataOperationData,
)
from services.errors.metadata import MetadataResourceNotFoundError
from services.metadata_service import MetadataService

DOCUMENT_ID = "11111111-1111-1111-1111-111111111111"
FOREIGN_DOCUMENT_ID = "22222222-2222-2222-2222-222222222222"
METADATA_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
FOREIGN_METADATA_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


def _account() -> Account:
    account = Account(name="User", email="user@example.com")
    account.id = "account-1"
    return account


def test_create_metadata_flushes_without_committing_caller_session(sqlite_session: Session) -> None:
    transaction_events: list[str] = []
    event.listen(sqlite_session, "after_commit", lambda _session: transaction_events.append("commit"))
    event.listen(sqlite_session, "after_rollback", lambda _session: transaction_events.append("rollback"))

    metadata = MetadataService.create_metadata(
        "dataset-1",
        MetadataArgs(type="string", name="author"),
        _account(),
        "tenant-1",
        session=sqlite_session,
    )

    assert metadata.name == "author"
    assert sqlite_session.get(DatasetMetadata, metadata.id) is metadata
    assert transaction_events == []


def _dataset(*, built_in_field_enabled: bool) -> Dataset:
    return Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        description="",
        provider="vendor",
        created_by="account-1",
        built_in_field_enabled=built_in_field_enabled,
    )


def _document() -> Document:
    return Document(
        id=DOCUMENT_ID,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="account-1",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 2),
        doc_metadata={},
    )


def test_enable_built_in_field_uses_caller_session_for_uploader(sqlite_session: Session) -> None:
    dataset = _dataset(built_in_field_enabled=False)
    document = _document()
    sqlite_session.add_all([_account(), dataset, document])
    sqlite_session.commit()

    with (
        patch.object(MetadataService, "knowledge_base_metadata_lock_check"),
        patch.object(DocumentService, "get_working_documents_by_dataset_id", return_value=[document]),
        patch("services.metadata_service.redis_client.delete"),
    ):
        MetadataService.enable_built_in_field(dataset, sqlite_session)

    assert document.doc_metadata[BuiltInField.uploader] == "User"


def test_update_documents_metadata_uses_caller_session_for_uploader(sqlite_session: Session) -> None:
    dataset = _dataset(built_in_field_enabled=True)
    document = _document()
    sqlite_session.add_all([_account(), dataset, document])
    sqlite_session.commit()
    metadata_args = MetadataOperationData(
        operation_data=[
            DocumentMetadataOperation(document_id=document.id, metadata_list=[], partial_update=False),
        ]
    )

    with (
        patch.object(MetadataService, "knowledge_base_metadata_lock_check"),
        patch("services.metadata_service.redis_client.delete"),
    ):
        MetadataService.update_documents_metadata(
            dataset,
            metadata_args,
            _account(),
            session=sqlite_session,
        )

    assert document.doc_metadata[BuiltInField.uploader] == "User"


def test_update_documents_metadata_rejects_foreign_metadata_before_writes() -> None:
    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    dataset = MagicMock(id="dataset-1", tenant_id="tenant-1")
    metadata_args = MetadataOperationData(
        operation_data=[
            DocumentMetadataOperation(
                document_id=DOCUMENT_ID,
                metadata_list=[MetadataDetail(id=FOREIGN_METADATA_ID, name="spoofed", value="value")],
                partial_update=False,
            )
        ]
    )

    with (
        pytest.raises(MetadataResourceNotFoundError, match="Metadata not found"),
        patch.object(MetadataService, "knowledge_base_metadata_lock_check") as lock_check,
    ):
        MetadataService.update_documents_metadata(dataset, metadata_args, _account(), session=session)

    lock_check.assert_not_called()
    session.add.assert_not_called()
    session.execute.assert_not_called()
    session.commit.assert_not_called()


def test_update_documents_metadata_validates_all_documents_before_writes() -> None:
    session = MagicMock()
    metadata = SimpleNamespace(id=METADATA_ID, name="canonical")
    session.scalars.return_value.all.side_effect = [[metadata], [DOCUMENT_ID]]
    dataset = MagicMock(id="dataset-1", tenant_id="tenant-1", built_in_field_enabled=False)
    metadata_detail = MetadataDetail(id=metadata.id, name="spoofed", value="value")
    metadata_args = MetadataOperationData(
        operation_data=[
            DocumentMetadataOperation(document_id=DOCUMENT_ID, metadata_list=[metadata_detail], partial_update=False),
            DocumentMetadataOperation(
                document_id=FOREIGN_DOCUMENT_ID, metadata_list=[metadata_detail], partial_update=False
            ),
        ]
    )

    with (
        pytest.raises(MetadataResourceNotFoundError, match="Document not found"),
        patch.object(MetadataService, "knowledge_base_metadata_lock_check") as lock_check,
        patch("services.metadata_service.redis_client.delete"),
    ):
        MetadataService.update_documents_metadata(dataset, metadata_args, _account(), session=session)

    lock_check.assert_not_called()
    session.add.assert_not_called()
    session.execute.assert_not_called()
    session.commit.assert_not_called()


def test_update_documents_metadata_uses_canonical_metadata_name() -> None:
    session = MagicMock()
    metadata = SimpleNamespace(id=METADATA_ID, name="canonical")
    session.scalars.return_value.all.side_effect = [[metadata], [DOCUMENT_ID]]
    dataset = MagicMock(id="dataset-1", tenant_id="tenant-1", built_in_field_enabled=False)
    document = _document()
    session.scalar.return_value = document
    metadata_args = MetadataOperationData(
        operation_data=[
            DocumentMetadataOperation(
                document_id=document.id,
                metadata_list=[MetadataDetail(id=metadata.id, name="spoofed", value="value")],
                partial_update=False,
            )
        ]
    )

    with (
        patch.object(MetadataService, "knowledge_base_metadata_lock_check"),
        patch("services.metadata_service.redis_client.delete"),
    ):
        MetadataService.update_documents_metadata(dataset, metadata_args, _account(), session=session)

    assert document.doc_metadata == {"canonical": "value"}


def test_metadata_operation_normalizes_uuid_ids() -> None:
    operation = DocumentMetadataOperation(
        document_id=DOCUMENT_ID.upper(),
        metadata_list=[MetadataDetail(id=METADATA_ID.upper(), name="ignored", value="value")],
    )

    assert operation.document_id == DOCUMENT_ID
    assert operation.metadata_list[0].id == METADATA_ID


def test_document_metadata_details_scopes_binding_to_document_owner() -> None:
    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    document = MagicMock(
        id="document-1",
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        doc_metadata={"canonical": "value"},
    )
    document.get_built_in_fields.return_value = []

    assert Document.get_doc_metadata_details(document, session=session) == []

    statement = str(session.scalars.call_args.args[0])
    assert "dataset_metadatas.tenant_id" in statement
    assert "dataset_metadatas.dataset_id" in statement
    assert "dataset_metadata_bindings.tenant_id" in statement
    assert "dataset_metadata_bindings.dataset_id" in statement
    assert "dataset_metadata_bindings.document_id" in statement


def test_get_dataset_metadatas_uses_caller_session(monkeypatch, sqlite_session: Session) -> None:
    dataset = _dataset(built_in_field_enabled=False)
    sqlite_session.add_all(
        [
            DatasetMetadataBinding(
                tenant_id="tenant-1",
                dataset_id="dataset-1",
                document_id=f"document-{index}",
                metadata_id="metadata-1",
                created_by="account-1",
            )
            for index in range(2)
        ]
    )
    sqlite_session.commit()

    def get_doc_metadata(_dataset: Dataset, *, session: Session) -> list[dict[str, str]]:
        assert session is sqlite_session
        return [{"id": "metadata-1", "name": "author", "type": "string"}]

    monkeypatch.setattr(Dataset, "get_doc_metadata", get_doc_metadata)

    result = MetadataService.get_dataset_metadatas(dataset, sqlite_session)

    assert result == {
        "doc_metadata": [{"id": "metadata-1", "name": "author", "type": "string", "count": 2}],
        "built_in_field_enabled": False,
    }
    assert sqlite_session.scalar(select(DatasetMetadataBinding).limit(1)) is not None
