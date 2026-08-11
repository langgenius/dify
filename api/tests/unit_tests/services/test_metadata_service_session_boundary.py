from datetime import datetime
from unittest.mock import patch

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
    MetadataOperationData,
)
from services.metadata_service import MetadataService


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
        id="document-1",
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
        patch.object(DocumentService, "get_document", return_value=document),
        patch("services.metadata_service.redis_client.delete"),
    ):
        MetadataService.update_documents_metadata(
            dataset,
            metadata_args,
            _account(),
            "tenant-1",
            session=sqlite_session,
        )

    assert document.doc_metadata[BuiltInField.uploader] == "User"


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
