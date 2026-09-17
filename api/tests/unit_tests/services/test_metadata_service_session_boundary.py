"""Metadata operations persist through scoped, independently owned transactions."""

from collections.abc import Iterator
from datetime import datetime
from unittest.mock import create_autospec

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from models import Account
from models.dataset import Dataset, DatasetMetadataBinding, Document
from models.enums import DocumentCreatedFrom
from repositories.knowledge.metadata_repository import SQLAlchemyMetadataRepository
from services.errors.metadata import MetadataResourceNotFoundError
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataArgs,
    MetadataDetail,
    MetadataOperationData,
)
from services.knowledge.metadata.application import MetadataService
from services.knowledge.resource_scope import DatasetRef

REF = DatasetRef("tenant-1", "dataset-1")
DOCUMENT_ID = "11111111-1111-1111-1111-111111111111"
FOREIGN_ID = "22222222-2222-2222-2222-222222222222"


@pytest.fixture
def metadata_service(sqlite_session_factory: sessionmaker[Session]) -> Iterator[MetadataService]:
    with sqlite_session_factory.begin() as session:
        account = Account(name="User", email="metadata@example.com")
        account.id = "actor"
        session.add(account)
        for ref, document_id in [(REF, DOCUMENT_ID), (DatasetRef("tenant-2", "dataset-2"), FOREIGN_ID)]:
            session.add(Dataset(id=ref.dataset_id, tenant_id=ref.tenant_id, name="Dataset", created_by="actor"))
            session.add(
                Document(
                    id=document_id,
                    tenant_id=ref.tenant_id,
                    dataset_id=ref.dataset_id,
                    position=1,
                    data_source_type="upload_file",
                    batch="batch",
                    name="Document",
                    created_from=DocumentCreatedFrom.API,
                    created_by="actor",
                    created_at=datetime(2026, 1, 1),
                    updated_at=datetime(2026, 1, 2),
                    enabled=True,
                    archived=False,
                    indexing_status="completed",
                    doc_metadata=None,
                )
            )
    return MetadataService(
        store=SQLAlchemyMetadataRepository(session_factory=sqlite_session_factory),
        dataset_access=create_autospec(DatasetAccess, instance=True),
    )


def test_create_commits_through_owned_session(
    metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    result = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
    fields = metadata_service.get_dataset_metadatas(REF)
    assert fields["doc_metadata"] == [{"id": result.id, "type": "string", "name": "author", "count": 0}]
    with sqlite_session_factory() as session:
        assert session.scalar(select(DatasetMetadataBinding)) is None


@pytest.mark.parametrize("name", ["x" * 256, "document_name", "uploader", "upload_date", "last_update_date", "source"])
def test_invalid_name_is_rejected(metadata_service: MetadataService, name: str) -> None:
    with pytest.raises(ValueError):
        metadata_service.create_metadata(REF, MetadataArgs(type="string", name=name), actor_id="actor")
    assert metadata_service.get_dataset_metadatas(REF)["doc_metadata"] == []


def test_duplicate_name_is_rejected(metadata_service: MetadataService) -> None:
    metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
    with pytest.raises(ValueError, match="already exists"):
        metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")


def _operation(document_id: str, metadata_id: str, *, partial: bool = False) -> MetadataOperationData:
    return MetadataOperationData(
        operation_data=[
            DocumentMetadataOperation(
                document_id=document_id,
                metadata_list=[MetadataDetail(id=metadata_id, name="spoofed", value="Alice")],
                partial_update=partial,
            )
        ]
    )


@pytest.mark.parametrize("partial", [True, False])
def test_update_uses_canonical_names_and_preserves_partial_values(
    metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session], partial: bool
) -> None:
    field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, DOCUMENT_ID)
        assert document is not None
        document.doc_metadata = {"existing": "kept"}
    metadata_service.update_documents_metadata(
        REF, _operation(DOCUMENT_ID, field.id, partial=partial), actor_id="actor"
    )
    metadata_service.update_documents_metadata(
        REF, _operation(DOCUMENT_ID, field.id, partial=partial), actor_id="actor"
    )
    with sqlite_session_factory() as session:
        document = session.get(Document, DOCUMENT_ID)
        assert document is not None
        assert document.doc_metadata == ({"existing": "kept", "author": "Alice"} if partial else {"author": "Alice"})
        assert len(session.scalars(select(DatasetMetadataBinding)).all()) == 1


@pytest.mark.parametrize("foreign", ["dataset", "document", "metadata"])
def test_owner_chain_is_validated_before_any_batch_write(
    metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session], foreign: str
) -> None:
    field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
    other = metadata_service.create_metadata(
        DatasetRef("tenant-2", "dataset-2"), MetadataArgs(type="string", name="foreign"), actor_id="actor"
    )
    args = _operation(DOCUMENT_ID, field.id)
    args.operation_data.extend(
        _operation(
            FOREIGN_ID if foreign == "document" else DOCUMENT_ID, other.id if foreign == "metadata" else field.id
        ).operation_data
    )
    ref = DatasetRef("tenant-2", REF.dataset_id) if foreign == "dataset" else REF
    with pytest.raises(MetadataResourceNotFoundError):
        metadata_service.update_documents_metadata(ref, args, actor_id="actor")
    with sqlite_session_factory() as session:
        assert all(document.doc_metadata is None for document in session.scalars(select(Document)))
        assert not session.scalars(select(DatasetMetadataBinding)).all()


def test_rename_delete_and_counts_share_scoped_bindings(
    metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
    metadata_service.update_documents_metadata(REF, _operation(DOCUMENT_ID, field.id), actor_id="actor")
    renamed = metadata_service.update_metadata_name(REF, field.id, "writer", actor_id="actor")
    assert renamed.name == "writer"
    assert metadata_service.get_dataset_metadatas(REF)["doc_metadata"] == [
        {"id": field.id, "name": "writer", "type": "string", "count": 1}
    ]
    with sqlite_session_factory() as session:
        document = session.get(Document, DOCUMENT_ID)
        assert document is not None
        assert document.doc_metadata == {"writer": "Alice"}
    metadata_service.delete_metadata(REF, field.id)
    with sqlite_session_factory() as session:
        document = session.get(Document, DOCUMENT_ID)
        assert document is not None
        assert document.doc_metadata == {}
        assert not session.scalars(select(DatasetMetadataBinding)).all()


def test_builtin_fields_use_owned_document_uploader(
    metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    metadata_service.enable_built_in_field(REF)
    with sqlite_session_factory() as session:
        document = session.get(Document, DOCUMENT_ID)
        foreign = session.get(Document, FOREIGN_ID)
        assert document is not None
        assert foreign is not None
        assert document.doc_metadata["uploader"] == "User"
        assert foreign.doc_metadata is None
    metadata_service.disable_built_in_field(REF)
    with sqlite_session_factory() as session:
        document = session.get(Document, DOCUMENT_ID)
        assert document is not None
        assert document.doc_metadata == {}


def test_commit_failure_rolls_back_document_and_bindings(
    metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")

    def fail(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(sqlite_session_factory.class_, "before_commit", fail)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            metadata_service.update_documents_metadata(REF, _operation(DOCUMENT_ID, field.id), actor_id="actor")
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", fail)
    with sqlite_session_factory() as session:
        document = session.get(Document, DOCUMENT_ID)
        assert document is not None
        assert document.doc_metadata is None
        assert not session.scalars(select(DatasetMetadataBinding)).all()
