from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from uuid import uuid4

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

import tasks.add_document_to_index_task as add_task_module
import tasks.document_index_state_task_support as state_support
import tasks.remove_document_from_index_task as remove_task_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models import Account
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    dataset_index_lock_name,
    document_index_lock_name,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease


@contextmanager
def _skipped_state_execution(
    _document_id: str,
    _expected_generation: str | None,
    _outbox_id: str | None,
    *,
    action: str,
) -> Generator[None]:
    assert action in {"add", "remove"}
    yield None


@dataclass(frozen=True)
class _ClaimedStateTask:
    ref: DocumentRef
    indexing_execution: DocumentIndexingExecution


@contextmanager
def _claimed_state_execution(
    document_id: str,
    expected_generation: str | None,
    _outbox_id: str | None,
    *,
    action: str,
) -> Generator[_ClaimedStateTask]:
    assert action in {"add", "remove"}
    yield _ClaimedStateTask(
        ref=DatasetRef("tenant-1", "dataset-1").document(document_id),
        indexing_execution=DocumentIndexingExecution(expected_generation, lambda: None),
    )


@contextmanager
def _claimed_delivery(_outbox_id: str | None) -> Generator[KnowledgeTaskExecutionLease]:
    yield KnowledgeTaskExecutionLease.untracked()


class _OwnedLease:
    @property
    def token(self) -> str:
        return "owned"

    def assert_owned(self) -> None:
        return

    def renew(self) -> bool:
        return True

    def release(self) -> bool:
        return True


def _configure_state_task_boundary(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[sessionmaker[Session], list[str]]:
    maker = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    acquired_locks: list[str] = []

    @contextmanager
    def create_session() -> Generator[Session]:
        with maker() as session:
            yield session

    class RecordingIndexingLock:
        def __init__(self, *, redis: object) -> None:
            del redis

        @contextmanager
        def hold(
            self,
            name: str,
            *,
            timeout: int,
            expected_token: str | None = None,
            blocking_timeout: float = 0,
        ) -> Generator[KnowledgeIndexingLease]:
            del timeout, expected_token, blocking_timeout
            acquired_locks.append(name)
            yield _OwnedLease()

    monkeypatch.setattr(state_support.session_factory, "create_session", create_session)
    monkeypatch.setattr(state_support.session_factory, "get_session_maker", lambda: maker)
    monkeypatch.setattr(state_support, "RedisKnowledgeIndexingLock", RecordingIndexingLock)
    monkeypatch.setattr(state_support, "knowledge_task_execution", _claimed_delivery)
    monkeypatch.setattr(state_support, "wake_knowledge_task_dispatcher_after_commit", lambda _session: None)
    return maker, acquired_locks


def _persist_document_state(
    session: Session,
    *,
    enabled: bool,
    archived: bool,
    segment_enabled: bool,
    generation: str,
) -> tuple[Dataset, Document, DocumentSegment]:
    user = Account(name="Index owner", email=f"index-owner-{uuid4()}@example.com")
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Index dataset",
        created_by=user.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="index-state",
        name="Document index state",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=IndexingStatus.COMPLETED,
        indexing_generation=generation,
        enabled=enabled,
        archived=archived,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="indexed content",
        word_count=2,
        tokens=2,
        index_node_id=str(uuid4()),
        index_node_hash="indexed",
        created_by=user.id,
        status=SegmentStatus.COMPLETED,
        enabled=segment_enabled,
    )
    session.add_all([user, dataset, document, segment])
    session.commit()
    return dataset, document, segment


def test_duplicate_document_state_deliveries_do_not_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def run_add(
        _document_ref: DocumentRef,
        _outbox_id: str | None,
        _execution: DocumentIndexingExecution,
    ) -> None:
        calls.append("add")

    def run_remove(
        _document_ref: DocumentRef,
        _outbox_id: str | None,
        _execution: DocumentIndexingExecution,
    ) -> None:
        calls.append("remove")

    monkeypatch.setattr(add_task_module, "document_index_state_task_execution", _skipped_state_execution)
    monkeypatch.setattr(add_task_module, "_run_add_document_to_index", run_add)
    monkeypatch.setattr(remove_task_module, "document_index_state_task_execution", _skipped_state_execution)
    monkeypatch.setattr(remove_task_module, "_run_remove_document_from_index", run_remove)

    add_task_module.add_document_to_index_task.run("document-1", "generation-1", "intent-1")
    remove_task_module.remove_document_from_index_task.run("document-1", "generation-1", "intent-2")

    assert calls == []


def test_unversioned_document_deliveries_convert_before_index_io(monkeypatch: pytest.MonkeyPatch) -> None:
    converted: list[str] = []

    class LegacyConvertingRepository:
        def __init__(self, **_kwargs: object) -> None:
            return

        def convert_legacy_index_state_delivery(self, document_id: str) -> bool:
            converted.append(document_id)
            return len(converted) == 1

    monkeypatch.setattr(state_support.session_factory, "get_session_maker", lambda: object())
    monkeypatch.setattr(state_support, "SQLAlchemyDocumentRepository", LegacyConvertingRepository)
    monkeypatch.setattr(
        add_task_module,
        "_run_add_document_to_index",
        lambda *_args, **_kwargs: pytest.fail("legacy add reached index I/O"),
    )
    monkeypatch.setattr(
        remove_task_module,
        "_run_remove_document_from_index",
        lambda *_args, **_kwargs: pytest.fail("legacy remove reached index I/O"),
    )

    add_task_module.add_document_to_index_task.run("document-1")
    remove_task_module.remove_document_from_index_task.run("document-1")

    assert converted == ["document-1", "document-1"]


def test_unversioned_document_conversion_failure_is_not_acknowledged(monkeypatch: pytest.MonkeyPatch) -> None:
    class FailingRepository:
        def __init__(self, **_kwargs: object) -> None:
            return

        def convert_legacy_index_state_delivery(self, _document_id: str) -> bool:
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(state_support.session_factory, "get_session_maker", lambda: object())
    monkeypatch.setattr(state_support, "SQLAlchemyDocumentRepository", FailingRepository)

    with pytest.raises(RuntimeError, match="database unavailable"):
        add_task_module.add_document_to_index_task.run("document-1")


def test_document_state_tasks_pass_execution_lease_to_mutation_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executions: list[DocumentIndexingExecution] = []

    def run_add(
        _document_ref: DocumentRef,
        _outbox_id: str | None,
        execution: DocumentIndexingExecution,
    ) -> None:
        executions.append(execution)

    def run_remove(
        _document_ref: DocumentRef,
        _outbox_id: str | None,
        execution: DocumentIndexingExecution,
    ) -> None:
        executions.append(execution)

    monkeypatch.setattr(add_task_module, "document_index_state_task_execution", _claimed_state_execution)
    monkeypatch.setattr(add_task_module, "_run_add_document_to_index", run_add)
    monkeypatch.setattr(remove_task_module, "document_index_state_task_execution", _claimed_state_execution)
    monkeypatch.setattr(remove_task_module, "_run_remove_document_from_index", run_remove)

    add_task_module.add_document_to_index_task.run("document-1", "generation-1", "intent-1")
    remove_task_module.remove_document_from_index_task.run("document-1", "generation-1", "intent-2")

    assert len(executions) == 2
    assert [execution.expected_generation for execution in executions] == ["generation-1", "generation-1"]


def test_recovered_expired_document_state_execution_persists_current_repair_before_io(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    maker, _acquired_locks = _configure_state_task_boundary(sqlite_session, monkeypatch)
    dataset, document, _segment = _persist_document_state(
        sqlite_session,
        enabled=True,
        archived=False,
        segment_enabled=False,
        generation="expired-generation",
    )

    class RecoveredDelivery:
        recovered_execution = True

        def assert_owned(self) -> None:
            return

    @contextmanager
    def recovered_delivery(_outbox_id: str | None) -> Generator[RecoveredDelivery]:
        yield RecoveredDelivery()

    monkeypatch.setattr(state_support, "knowledge_task_execution", recovered_delivery)

    with state_support.document_index_state_task_execution(
        document.id,
        "expired-generation",
        "intent-1",
        action="add",
    ) as context:
        assert context is None

    with maker() as session:
        persisted = session.get(Document, document.id)
        repair = session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.document_id == document.id,
                KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DOCUMENT_INDEX_STATE.value,
            )
        )
        assert persisted is not None
        assert persisted.indexing_generation != "expired-generation"
        assert repair is not None
        assert repair.tenant_id == dataset.tenant_id
        assert repair.payload == {
            "document_id": document.id,
            "generation": persisted.indexing_generation,
            "action": "add",
        }


@pytest.mark.parametrize(("enabled", "archived"), [(False, False), (True, True)])
def test_remove_repair_accepts_inactive_incomplete_document(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
    archived: bool,
) -> None:
    user = Account(name="Index owner", email=f"index-owner-{uuid4()}@example.com")
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Index dataset",
        created_by=user.id,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.ECONOMY,
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    document = Document(
        id=str(uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="remove-repair",
        name="Disabled document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=user.id,
        indexing_status=IndexingStatus.PARSING,
        indexing_generation="generation-1",
        enabled=enabled,
        archived=archived,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="partial content",
        word_count=2,
        tokens=2,
        index_node_id=str(uuid4()),
        index_node_hash="partial",
        created_by=user.id,
        status=SegmentStatus.COMPLETED,
        enabled=True,
    )
    sqlite_session.add_all([user, dataset, document, segment])
    sqlite_session.commit()
    cleaned_nodes: list[str] = []

    class RecordingProcessor:
        def clean(
            self,
            _dataset: Dataset,
            node_ids: list[str],
            **_kwargs: object,
        ) -> None:
            cleaned_nodes.extend(node_ids)

    class RecordingProcessorFactory:
        def __init__(self, _index_type: object) -> None:
            return

        def init_index_processor(self) -> RecordingProcessor:
            return RecordingProcessor()

    @contextmanager
    def create_session() -> Generator[Session]:
        with Session(sqlite_session.get_bind()) as session:
            yield session

    monkeypatch.setattr(remove_task_module.session_factory, "create_session", create_session)
    monkeypatch.setattr(remove_task_module, "IndexProcessorFactory", RecordingProcessorFactory)
    monkeypatch.setattr(remove_task_module.redis_client, "delete", lambda _key: None)
    monkeypatch.setattr(
        "services.knowledge.summaries.adapters.SummaryIndexAdapter.disable_summaries_for_segments",
        lambda **_kwargs: None,
    )

    remove_task_module._run_remove_document_from_index(
        DatasetRef(dataset.tenant_id, dataset.id).document(document.id),
        "repair-intent",
        DocumentIndexingExecution("generation-1", lambda: None),
    )

    sqlite_session.expire_all()
    persisted_segment = sqlite_session.get(DocumentSegment, segment.id)
    assert cleaned_nodes == [segment.index_node_id]
    assert persisted_segment is not None
    assert persisted_segment.enabled is False


def test_add_stops_after_successor_disables_document_and_enqueues_remove(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    previous_generation = str(uuid4())
    successor_generation = str(uuid4())
    dataset, document, segment = _persist_document_state(
        sqlite_session,
        enabled=True,
        archived=False,
        segment_enabled=False,
        generation=previous_generation,
    )
    maker, acquired_locks = _configure_state_task_boundary(sqlite_session, monkeypatch)
    loaded_nodes: list[str] = []

    class GenerationChangingProcessor:
        def load(
            self,
            _dataset: Dataset,
            documents: list[object],
            **_kwargs: object,
        ) -> None:
            loaded_nodes.extend(str(item) for item in documents)
            with maker.begin() as session:
                session.execute(
                    update(Document)
                    .where(Document.id == document.id)
                    .values(indexing_generation=successor_generation, enabled=False)
                )

    class GenerationChangingProcessorFactory:
        def __init__(self, _index_type: object) -> None:
            return

        def init_index_processor(self) -> GenerationChangingProcessor:
            return GenerationChangingProcessor()

    monkeypatch.setattr(add_task_module, "IndexProcessorFactory", GenerationChangingProcessorFactory)

    add_task_module.add_document_to_index_task.run(document.id, previous_generation, "add-intent")

    sqlite_session.expire_all()
    persisted_document = sqlite_session.get(Document, document.id)
    persisted_segment = sqlite_session.get(DocumentSegment, segment.id)
    repair = sqlite_session.scalar(
        select(KnowledgeTaskOutbox)
        .where(
            KnowledgeTaskOutbox.document_id == document.id,
            KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DOCUMENT_INDEX_STATE,
        )
        .order_by(KnowledgeTaskOutbox.created_at.desc())
    )
    assert loaded_nodes
    assert acquired_locks == [
        dataset_index_lock_name(dataset.id),
        document_index_lock_name(document.id),
    ]
    assert persisted_segment is not None
    assert persisted_segment.enabled is False
    assert persisted_document is not None
    assert persisted_document.indexing_generation != successor_generation
    assert repair is not None
    assert repair.payload == {
        "document_id": document.id,
        "generation": persisted_document.indexing_generation,
        "action": "remove",
    }


def test_remove_stops_after_successor_enables_document_and_enqueues_add(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    previous_generation = str(uuid4())
    successor_generation = str(uuid4())
    dataset, document, segment = _persist_document_state(
        sqlite_session,
        enabled=False,
        archived=False,
        segment_enabled=True,
        generation=previous_generation,
    )
    maker, acquired_locks = _configure_state_task_boundary(sqlite_session, monkeypatch)
    cleaned_nodes: list[str] = []

    class GenerationChangingProcessor:
        def clean(
            self,
            _dataset: Dataset,
            node_ids: list[str],
            **_kwargs: object,
        ) -> None:
            cleaned_nodes.extend(node_ids)
            with maker.begin() as session:
                session.execute(
                    update(Document)
                    .where(Document.id == document.id)
                    .values(
                        indexing_generation=successor_generation,
                        enabled=True,
                        archived=False,
                        indexing_status=IndexingStatus.COMPLETED,
                    )
                )

    class GenerationChangingProcessorFactory:
        def __init__(self, _index_type: object) -> None:
            return

        def init_index_processor(self) -> GenerationChangingProcessor:
            return GenerationChangingProcessor()

    monkeypatch.setattr(remove_task_module, "IndexProcessorFactory", GenerationChangingProcessorFactory)
    monkeypatch.setattr(
        "services.knowledge.summaries.adapters.SummaryIndexAdapter.disable_summaries_for_segments",
        lambda **_kwargs: None,
    )

    remove_task_module.remove_document_from_index_task.run(document.id, previous_generation, "remove-intent")

    sqlite_session.expire_all()
    persisted_document = sqlite_session.get(Document, document.id)
    persisted_segment = sqlite_session.get(DocumentSegment, segment.id)
    repair = sqlite_session.scalar(
        select(KnowledgeTaskOutbox)
        .where(
            KnowledgeTaskOutbox.document_id == document.id,
            KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DOCUMENT_INDEX_STATE,
        )
        .order_by(KnowledgeTaskOutbox.created_at.desc())
    )
    assert cleaned_nodes == [segment.index_node_id]
    assert acquired_locks == [
        dataset_index_lock_name(dataset.id),
        document_index_lock_name(document.id),
    ]
    assert persisted_segment is not None
    assert persisted_segment.enabled is True
    assert persisted_document is not None
    assert persisted_document.indexing_generation != successor_generation
    assert repair is not None
    assert repair.payload == {
        "document_id": document.id,
        "generation": persisted_document.indexing_generation,
        "action": "add",
    }
