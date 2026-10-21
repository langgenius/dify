from datetime import datetime

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.sql import Select

from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.documents.contracts import DocumentPersistenceArchivedError
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox import gateway
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit

REF = DatasetRef("tenant-1", "dataset-1")


def _document() -> Document:
    return Document(
        id="document-1",
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info='{"upload_file_id":"file-1"}',
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="account-1",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        indexing_status=IndexingStatus.COMPLETED,
        doc_form="text_model",
        enabled=True,
        archived=False,
    )


def _seed(session_factory: sessionmaker[Session], *, with_document: bool = True) -> None:
    with session_factory.begin() as session:
        session.add(Dataset(id=REF.dataset_id, tenant_id=REF.tenant_id, name="Dataset", created_by="account-1"))
        if with_document:
            session.add(_document())


class WakeRecorder:
    def __init__(self, *, succeeds: bool) -> None:
        self.succeeds = succeeds
        self.calls = 0

    def __call__(self) -> bool:
        self.calls += 1
        return self.succeeds


def _repository(session_factory: sessionmaker[Session]) -> SQLAlchemyDocumentRepository:
    return SQLAlchemyDocumentRepository(
        session_factory=session_factory,
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    )


def test_delete_document_commits_cleanup_intent_before_waking_dispatcher(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed(sqlite_session_factory)
    wake = WakeRecorder(succeeds=True)
    monkeypatch.setattr(gateway, "wake_knowledge_task_dispatcher", wake)
    document_lock_queries: list[tuple[str, bool]] = []

    def record_document_lock(execute_state: ORMExecuteState) -> None:
        if not isinstance(execute_state.statement, Select):
            return
        sql = str(execute_state.statement.compile(dialect=postgresql.dialect()))
        # Cleanup also takes separate NOWAIT owner locks; record only the command's ordered document lock.
        if "FROM documents" in sql and "FOR UPDATE OF documents" in sql:
            document_lock_queries.append((sql, execute_state.execution_options.get("populate_existing") is True))

    event.listen(sqlite_session_factory.class_, "do_orm_execute", record_document_lock)
    try:
        assert _repository(sqlite_session_factory).delete_document(REF.document("document-1")) is True
    finally:
        event.remove(sqlite_session_factory.class_, "do_orm_execute", record_document_lock)

    assert len(document_lock_queries) == 1
    lock_sql, populate_existing = document_lock_queries[0]
    assert "ORDER BY documents.id ASC" in lock_sql
    assert "FOR UPDATE OF documents" in lock_sql
    assert populate_existing is True
    with sqlite_session_factory() as session:
        assert session.get(Document, "document-1") is None
        intent = session.scalar(select(KnowledgeTaskOutbox))
        assert intent is not None
        assert intent.status == "pending"
        assert intent.task_kind == "document_cleanup"
        assert intent.payload == {
            "tenant_id": REF.tenant_id,
            "document_id": "document-1",
            "dataset_id": REF.dataset_id,
            "doc_form": "text_model",
            "file_id": "file-1",
            "cleanup_manifest": {
                "document_files": [{"id": "file-1", "key": None}],
                "image_files": [],
                "segment_attachments": [],
            },
        }
    assert wake.calls == 1


def test_delete_document_keeps_committed_intent_when_dispatcher_wakeup_fails(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed(sqlite_session_factory)
    wake = WakeRecorder(succeeds=False)
    monkeypatch.setattr(gateway, "wake_knowledge_task_dispatcher", wake)

    assert _repository(sqlite_session_factory).delete_document(REF.document("document-1")) is True

    assert wake.calls == 1
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(KnowledgeTaskOutbox)) == 1


def test_delete_document_is_idempotent_when_scoped_row_is_already_missing(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed(sqlite_session_factory, with_document=False)
    wake = WakeRecorder(succeeds=True)
    monkeypatch.setattr(gateway, "wake_knowledge_task_dispatcher", wake)

    assert _repository(sqlite_session_factory).delete_document(REF.document("document-1")) is False

    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(KnowledgeTaskOutbox)) == 0
    assert wake.calls == 0


def test_delete_document_commit_failure_rolls_back_document_and_cleanup_intent(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed(sqlite_session_factory)
    wake = WakeRecorder(succeeds=True)
    monkeypatch.setattr(gateway, "wake_knowledge_task_dispatcher", wake)

    def reject_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(sqlite_session_factory.class_, "before_commit", reject_commit)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            _repository(sqlite_session_factory).delete_document(REF.document("document-1"))
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", reject_commit)

    with sqlite_session_factory() as session:
        assert session.get(Document, "document-1") is not None
        assert session.scalar(select(func.count()).select_from(KnowledgeTaskOutbox)) == 0
    assert wake.calls == 0


def test_delete_document_rejects_archived_row_after_lock(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _seed(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, "document-1")
        assert document is not None
        document.archived = True

    with pytest.raises(DocumentPersistenceArchivedError):
        _repository(sqlite_session_factory).delete_document(REF.document("document-1"))

    with sqlite_session_factory() as session:
        assert session.get(Document, "document-1") is not None
        assert session.scalar(select(func.count()).select_from(KnowledgeTaskOutbox)) == 0


def test_batch_delete_rejects_all_rows_when_one_locked_document_is_archived(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _seed(sqlite_session_factory)
    second = _document()
    second.id = "document-2"
    second.position = 2
    second.data_source_info = '{"upload_file_id":"file-2"}'
    second.archived = True
    with sqlite_session_factory.begin() as session:
        session.add(second)

    with pytest.raises(DocumentPersistenceArchivedError):
        _repository(sqlite_session_factory).delete_documents(REF, ["document-1", "document-2"])

    with sqlite_session_factory() as session:
        assert session.get(Document, "document-1") is not None
        assert session.get(Document, "document-2") is not None
        assert session.scalar(select(func.count()).select_from(KnowledgeTaskOutbox)) == 0
