"""Container-backed status-transition tests for the document repository.

The former suite exercised ``DatasetService`` after that facade had been
removed. These cases keep the relational boundary real and exercise the
repository now responsible for atomic document status changes.
"""

import datetime
import json
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.documents.contracts import DocumentPersistenceInvalidStateError, DocumentStatusAction
from services.knowledge.entities.resource_scope import DatasetRef


def _dataset(*, dataset_id: str, tenant_id: str) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=f"dataset-{dataset_id}",
        provider="vendor",
        created_by="actor",
        maintainer="actor",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique="economy",
    )


def _document(
    *,
    document_id: str,
    dataset_id: str,
    tenant_id: str,
    enabled: bool = True,
    archived: bool = False,
    indexing_status: str = IndexingStatus.COMPLETED,
) -> Document:
    completed_at = datetime.datetime(2026, 1, 1) if indexing_status == IndexingStatus.COMPLETED else None
    return Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info=json.dumps({"upload_file_id": str(uuid4())}),
        batch=f"batch-{uuid4()}",
        name=f"document-{document_id}",
        created_from=DocumentCreatedFrom.WEB,
        created_by="actor",
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        indexing_status=indexing_status,
        completed_at=completed_at,
        enabled=enabled,
        archived=archived,
    )


def _repository(session: Session) -> SQLAlchemyDocumentRepository:
    return SQLAlchemyDocumentRepository(
        session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False),
    )


@pytest.mark.parametrize(
    ("action", "enabled", "archived", "expected_enabled", "expected_archived"),
    [
        ("enable", False, False, True, False),
        ("disable", True, False, False, False),
        ("archive", True, False, True, True),
        ("un_archive", True, True, True, False),
    ],
)
def test_change_status_commits_active_state_transition(
    db_session_with_containers: Session,
    action: DocumentStatusAction,
    enabled: bool,
    archived: bool,
    expected_enabled: bool,
    expected_archived: bool,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    db_session_with_containers.add_all(
        [
            _dataset(dataset_id=dataset_id, tenant_id=tenant_id),
            _document(
                document_id=document_id,
                dataset_id=dataset_id,
                tenant_id=tenant_id,
                enabled=enabled,
                archived=archived,
            ),
        ]
    )
    db_session_with_containers.commit()

    mutation = _repository(db_session_with_containers).change_status(
        DatasetRef(tenant_id, dataset_id),
        [document_id],
        action=action,
        actor_id="actor",
    )

    db_session_with_containers.rollback()
    persisted = db_session_with_containers.get_one(Document, document_id)
    assert (persisted.enabled, persisted.archived) == (expected_enabled, expected_archived)
    assert mutation.indexing_document_ids == (document_id,)
    if action == "disable":
        assert persisted.disabled_by == "actor"
        assert persisted.disabled_at is not None
    elif action == "archive":
        assert persisted.archived_by == "actor"
        assert persisted.archived_at is not None
    elif action == "enable":
        assert persisted.disabled_by is None
        assert persisted.disabled_at is None
    else:
        assert persisted.archived_by is None
        assert persisted.archived_at is None


def test_change_status_skips_missing_foreign_and_already_matching_documents(
    db_session_with_containers: Session,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    other_tenant_id = str(uuid4())
    other_dataset_id = str(uuid4())
    db_session_with_containers.add_all(
        [
            _dataset(dataset_id=dataset_id, tenant_id=tenant_id),
            _dataset(dataset_id=other_dataset_id, tenant_id=other_tenant_id),
            _document(document_id="owned-disabled", dataset_id=dataset_id, tenant_id=tenant_id, enabled=False),
            _document(document_id="owned-enabled", dataset_id=dataset_id, tenant_id=tenant_id),
            _document(document_id="foreign", dataset_id=other_dataset_id, tenant_id=other_tenant_id, enabled=False),
        ]
    )
    db_session_with_containers.commit()

    mutation = _repository(db_session_with_containers).change_status(
        DatasetRef(tenant_id, dataset_id),
        ["missing", "foreign", "owned-enabled", "owned-disabled", "owned-disabled"],
        action="enable",
        actor_id="actor",
    )

    assert mutation.indexing_document_ids == ("owned-disabled",)
    db_session_with_containers.rollback()
    assert db_session_with_containers.get_one(Document, "owned-disabled").enabled is True
    assert db_session_with_containers.get_one(Document, "foreign").enabled is False


def test_invalid_batch_transition_rolls_back_all_documents(
    db_session_with_containers: Session,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    db_session_with_containers.add_all(
        [
            _dataset(dataset_id=dataset_id, tenant_id=tenant_id),
            _document(document_id="a-completed", dataset_id=dataset_id, tenant_id=tenant_id),
            _document(
                document_id="b-indexing",
                dataset_id=dataset_id,
                tenant_id=tenant_id,
                indexing_status=IndexingStatus.INDEXING,
            ),
        ]
    )
    db_session_with_containers.commit()

    with pytest.raises(DocumentPersistenceInvalidStateError, match="is not completed"):
        _repository(db_session_with_containers).change_status(
            DatasetRef(tenant_id, dataset_id),
            ["a-completed", "b-indexing"],
            action="disable",
            actor_id="actor",
        )

    db_session_with_containers.rollback()
    assert db_session_with_containers.get_one(Document, "a-completed").enabled is True
    assert db_session_with_containers.get_one(Document, "b-indexing").enabled is True
