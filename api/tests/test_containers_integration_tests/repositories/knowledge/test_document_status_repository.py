"""PostgreSQL coverage for document status mutations and their durable intents."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Event, get_ident
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import UploadFile
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.documents.contracts import (
    DocumentPersistenceArchivedError,
    DocumentPersistenceInvalidStateError,
    DocumentStatusAction,
)
from services.knowledge.resource_scope import DatasetRef


def _dataset(session: Session, *, tenant_id: str, owner_id: str, name: str) -> Dataset:
    dataset = Dataset(
        tenant_id=tenant_id,
        name=name,
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        created_by=owner_id,
        maintainer=owner_id,
    )
    session.add(dataset)
    session.flush()
    return dataset


def _document(
    session: Session,
    *,
    dataset: Dataset,
    document_id: str | None = None,
    position: int = 1,
    enabled: bool = True,
    archived: bool = False,
    indexing_status: IndexingStatus = IndexingStatus.COMPLETED,
    generation: str | None = None,
) -> Document:
    upload_file = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"uploads/{uuid4()}",
        name=f"document-{position}.txt",
        size=128,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=dataset.created_by,
        created_at=datetime(2026, 1, 1),
        used=True,
    )
    session.add(upload_file)
    session.flush()
    document = Document(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=position,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info=json.dumps({"upload_file_id": upload_file.id}),
        batch=f"batch-{uuid4()}",
        name=f"document-{position}.txt",
        created_from=DocumentCreatedFrom.API,
        created_by=dataset.created_by,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        indexing_status=indexing_status,
        enabled=enabled,
        archived=archived,
        indexing_generation=generation,
    )
    if document_id is not None:
        document.id = document_id
    if indexing_status == IndexingStatus.COMPLETED:
        document.completed_at = datetime(2026, 1, 1)
    session.add(document)
    session.flush()
    return document


def _sessions(session: Session) -> sessionmaker[Session]:
    return sessionmaker(bind=session.get_bind(), expire_on_commit=False)


def _intents(session: Session, document_id: str) -> list[KnowledgeTaskOutbox]:
    return list(
        session.scalars(
            select(KnowledgeTaskOutbox)
            .where(
                KnowledgeTaskOutbox.document_id == document_id,
                KnowledgeTaskOutbox.task_kind == "document_index_state",
            )
            .order_by(KnowledgeTaskOutbox.created_at, KnowledgeTaskOutbox.id)
        ).all()
    )


@pytest.mark.parametrize(
    ("action", "enabled", "archived", "expected_enabled", "expected_archived", "index_action"),
    [
        ("enable", False, False, True, False, "add"),
        ("disable", True, False, False, False, "remove"),
        ("archive", True, False, True, True, "remove"),
        ("archive", False, False, False, True, None),
        ("un_archive", True, True, True, False, "add"),
        ("un_archive", False, True, False, False, None),
    ],
)
def test_status_changes_commit_state_with_matching_durable_intent(
    db_session_with_containers: Session,
    action: DocumentStatusAction,
    enabled: bool,
    archived: bool,
    expected_enabled: bool,
    expected_archived: bool,
    index_action: str | None,
) -> None:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    dataset = _dataset(
        db_session_with_containers,
        tenant_id=tenant_id,
        owner_id=actor_id,
        name="Status transitions",
    )
    document = _document(
        db_session_with_containers,
        dataset=dataset,
        enabled=enabled,
        archived=archived,
    )
    document_id = document.id
    dataset_id = dataset.id
    db_session_with_containers.commit()
    sessions = _sessions(db_session_with_containers)
    generation = str(uuid4())

    mutation = SQLAlchemyDocumentRepository(session_factory=sessions).change_status(
        DatasetRef(tenant_id, dataset_id),
        [document_id],
        action=action,
        actor_id=actor_id,
        generations={document_id: generation},
    )

    assert mutation.indexing_document_ids == ((document_id,) if index_action is not None else ())
    with sessions() as verification_session:
        persisted = verification_session.get(Document, document_id)
        assert persisted is not None
        assert persisted.enabled is expected_enabled
        assert persisted.archived is expected_archived
        assert persisted.updated_at is not None
        if action == "enable":
            assert persisted.disabled_at is None
            assert persisted.disabled_by is None
        elif action == "disable":
            assert persisted.disabled_at is not None
            assert persisted.disabled_by == actor_id
        elif action == "archive":
            assert persisted.archived_at is not None
            assert persisted.archived_by == actor_id
        else:
            assert persisted.archived_at is None
            assert persisted.archived_by is None
        intents = _intents(verification_session, document_id)

    if index_action is None:
        assert persisted.indexing_generation is None
        assert intents == []
    else:
        assert persisted.indexing_generation == generation
        assert len(intents) == 1
        assert intents[0].tenant_id == tenant_id
        assert intents[0].dataset_id == dataset_id
        assert intents[0].resource_id == document_id
        assert intents[0].status == "pending"
        assert intents[0].payload == {
            "document_id": document_id,
            "generation": generation,
            "action": index_action,
        }


def test_noop_missing_and_foreign_documents_do_not_create_intents(db_session_with_containers: Session) -> None:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    dataset = _dataset(db_session_with_containers, tenant_id=tenant_id, owner_id=actor_id, name="Target")
    foreign_dataset = _dataset(db_session_with_containers, tenant_id=tenant_id, owner_id=actor_id, name="Foreign")
    enabled = _document(db_session_with_containers, dataset=dataset, enabled=True)
    foreign = _document(db_session_with_containers, dataset=foreign_dataset, enabled=False)
    db_session_with_containers.commit()
    sessions = _sessions(db_session_with_containers)

    mutation = SQLAlchemyDocumentRepository(session_factory=sessions).change_status(
        DatasetRef(tenant_id, dataset.id),
        [enabled.id, foreign.id, str(uuid4()), enabled.id],
        action="enable",
        actor_id=actor_id,
        generations={enabled.id: str(uuid4()), foreign.id: str(uuid4())},
    )

    assert mutation.indexing_document_ids == ()
    with sessions() as verification_session:
        persisted_foreign = verification_session.get(Document, foreign.id)
        assert persisted_foreign is not None
        assert persisted_foreign.enabled is False
        assert verification_session.scalar(select(KnowledgeTaskOutbox.id)) is None


@pytest.mark.parametrize(
    ("action", "enabled", "archived"),
    [
        ("disable", False, False),
        ("archive", True, True),
        ("un_archive", True, False),
    ],
)
def test_repeated_status_action_is_a_noop(
    db_session_with_containers: Session,
    action: DocumentStatusAction,
    enabled: bool,
    archived: bool,
) -> None:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    dataset = _dataset(db_session_with_containers, tenant_id=tenant_id, owner_id=actor_id, name="No-op")
    document = _document(
        db_session_with_containers,
        dataset=dataset,
        enabled=enabled,
        archived=archived,
    )
    db_session_with_containers.commit()
    sessions = _sessions(db_session_with_containers)

    mutation = SQLAlchemyDocumentRepository(session_factory=sessions).change_status(
        DatasetRef(tenant_id, dataset.id),
        [document.id],
        action=action,
        actor_id=actor_id,
        generations={document.id: str(uuid4())},
    )

    assert mutation.indexing_document_ids == ()
    with sessions() as verification_session:
        persisted = verification_session.get(Document, document.id)
        assert persisted is not None
        assert persisted.enabled is enabled
        assert persisted.archived is archived
        assert persisted.indexing_generation is None
        assert verification_session.scalar(select(KnowledgeTaskOutbox.id)) is None


def test_invalid_document_in_batch_rolls_back_prior_state_and_intent(db_session_with_containers: Session) -> None:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    dataset = _dataset(db_session_with_containers, tenant_id=tenant_id, owner_id=actor_id, name="Atomic batch")
    completed = _document(
        db_session_with_containers,
        dataset=dataset,
        document_id="00000000-0000-0000-0000-000000000001",
        enabled=True,
    )
    indexing = _document(
        db_session_with_containers,
        dataset=dataset,
        document_id="00000000-0000-0000-0000-000000000002",
        position=2,
        enabled=True,
        indexing_status=IndexingStatus.INDEXING,
    )
    db_session_with_containers.commit()
    sessions = _sessions(db_session_with_containers)

    with pytest.raises(DocumentPersistenceInvalidStateError, match="is not completed"):
        SQLAlchemyDocumentRepository(session_factory=sessions).change_status(
            DatasetRef(tenant_id, dataset.id),
            [completed.id, indexing.id],
            action="disable",
            actor_id=actor_id,
            generations={completed.id: str(uuid4()), indexing.id: str(uuid4())},
        )

    with sessions() as verification_session:
        persisted_completed = verification_session.get(Document, completed.id)
        persisted_indexing = verification_session.get(Document, indexing.id)
        assert persisted_completed is not None
        assert persisted_indexing is not None
        assert persisted_completed.enabled is True
        assert persisted_indexing.enabled is True
        assert verification_session.scalar(select(KnowledgeTaskOutbox.id)) is None


@pytest.mark.parametrize(
    ("action", "enabled", "archived", "index_action"),
    [
        ("enable", True, False, "add"),
        ("disable", False, False, "remove"),
        ("archive", True, True, "remove"),
        ("un_archive", True, False, "add"),
    ],
)
def test_failed_current_generation_can_be_requeued_with_a_new_generation(
    db_session_with_containers: Session,
    action: DocumentStatusAction,
    enabled: bool,
    archived: bool,
    index_action: str,
) -> None:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    dataset = _dataset(db_session_with_containers, tenant_id=tenant_id, owner_id=actor_id, name="Retry")
    document = _document(
        db_session_with_containers,
        dataset=dataset,
        enabled=enabled,
        archived=archived,
        generation="failed-generation",
    )
    db_session_with_containers.add(
        KnowledgeTaskOutbox(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            resource_id=document.id,
            task_kind="document_index_state",
            payload={"document_id": document.id, "generation": "failed-generation", "action": index_action},
            status="failed",
        )
    )
    db_session_with_containers.commit()
    sessions = _sessions(db_session_with_containers)
    new_generation = str(uuid4())

    mutation = SQLAlchemyDocumentRepository(session_factory=sessions).change_status(
        DatasetRef(tenant_id, dataset.id),
        [document.id],
        action=action,
        actor_id=actor_id,
        generations={document.id: new_generation},
    )

    assert mutation.indexing_document_ids == (document.id,)
    with sessions() as verification_session:
        persisted = verification_session.get(Document, document.id)
        assert persisted is not None
        assert persisted.indexing_generation == new_generation
        intents = _intents(verification_session, document.id)
    assert len(intents) == 2
    assert intents[-1].status == "pending"
    assert intents[-1].payload == {
        "document_id": document.id,
        "generation": new_generation,
        "action": index_action,
    }


def test_commit_failure_rolls_back_state_and_durable_intent(db_session_with_containers: Session) -> None:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    dataset = _dataset(db_session_with_containers, tenant_id=tenant_id, owner_id=actor_id, name="Rollback")
    document = _document(db_session_with_containers, dataset=dataset, enabled=False)
    db_session_with_containers.commit()
    sessions = _sessions(db_session_with_containers)

    def reject_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(sessions.class_, "before_commit", reject_commit)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            SQLAlchemyDocumentRepository(session_factory=sessions).change_status(
                DatasetRef(tenant_id, dataset.id),
                [document.id],
                action="enable",
                actor_id=actor_id,
                generations={document.id: str(uuid4())},
            )
    finally:
        event.remove(sessions.class_, "before_commit", reject_commit)

    with sessions() as verification_session:
        persisted = verification_session.get(Document, document.id)
        assert persisted is not None
        assert persisted.enabled is False
        assert persisted.indexing_generation is None
        assert verification_session.scalar(select(KnowledgeTaskOutbox.id)) is None


def test_invalid_action_rolls_back_without_an_intent(db_session_with_containers: Session) -> None:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    dataset = _dataset(db_session_with_containers, tenant_id=tenant_id, owner_id=actor_id, name="Invalid action")
    document = _document(db_session_with_containers, dataset=dataset, enabled=True)
    db_session_with_containers.commit()
    sessions = _sessions(db_session_with_containers)

    with pytest.raises(DocumentPersistenceInvalidStateError, match="Invalid action"):
        SQLAlchemyDocumentRepository(session_factory=sessions).change_status(
            DatasetRef(tenant_id, dataset.id),
            [document.id],
            action=cast(DocumentStatusAction, "invalid"),
            actor_id=actor_id,
            generations={document.id: str(uuid4())},
        )

    with sessions() as verification_session:
        persisted = verification_session.get(Document, document.id)
        assert persisted is not None
        assert persisted.enabled is True
        assert verification_session.scalar(select(KnowledgeTaskOutbox.id)) is None


def test_website_sync_rechecks_archived_after_waiting_for_document_lock(
    db_session_with_containers: Session,
) -> None:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    dataset = _dataset(db_session_with_containers, tenant_id=tenant_id, owner_id=actor_id, name="Sync race")
    document = _document(
        db_session_with_containers,
        dataset=dataset,
        generation="archive-generation",
    )
    document.data_source_type = DataSourceType.WEBSITE_CRAWL
    document.data_source_info = json.dumps({"url": "https://example.com", "mode": "crawl"})
    db_session_with_containers.commit()
    sessions = _sessions(db_session_with_containers)
    engine = db_session_with_containers.get_bind()
    document_lock_attempted = Event()
    sync_thread_id: list[int] = []

    def observe_document_lock(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if sync_thread_id and get_ident() == sync_thread_id[0] and "documents" in statement.lower():
            if "for update" in statement.lower():
                document_lock_attempted.set()

    def sync_document() -> None:
        sync_thread_id.append(get_ident())
        SQLAlchemyDocumentRepository(session_factory=sessions).sync_website(
            DatasetRef(tenant_id, dataset.id).document(document.id),
            generation="sync-generation",
        )

    archive_session = sessions()
    try:
        locked = archive_session.scalar(select(Document).where(Document.id == document.id).with_for_update(of=Document))
        assert locked is not None
        locked.archived = True
        locked.archived_at = datetime(2026, 10, 20)
        locked.archived_by = actor_id
        event.listen(engine, "before_cursor_execute", observe_document_lock)
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(sync_document)
            assert document_lock_attempted.wait(timeout=10)
            archive_session.commit()
            with pytest.raises(DocumentPersistenceArchivedError, match="archived"):
                future.result(timeout=10)
    finally:
        event.remove(engine, "before_cursor_execute", observe_document_lock)
        archive_session.close()

    with sessions() as verification_session:
        persisted = verification_session.get(Document, document.id)
        assert persisted is not None
        assert persisted.archived is True
        assert persisted.indexing_generation == "archive-generation"
        assert persisted.data_source_info_dict["mode"] == "crawl"
        assert _intents(verification_session, document.id) == []
