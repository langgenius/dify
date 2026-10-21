import json
import uuid
from collections.abc import Generator
from contextlib import contextmanager, nullcontext
from datetime import datetime
from importlib import import_module
from typing import Protocol, override
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import (
    ChildChunk,
    Dataset,
    DatasetKeywordTable,
    Document,
    DocumentSegment,
    DocumentSegmentSummary,
    SegmentAttachmentBinding,
)
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus, SummaryStatus
from models.knowledge_task import KnowledgeTaskOutbox
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError
from services.knowledge.summaries.adapters import SummaryIndexAdapter
from services.knowledge.summaries.application import SummaryWriteFence
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskPermanentError,
    KnowledgeTaskRequeuedError,
)
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease
from tasks.disable_segments_from_index_task import disable_segments_from_index_task
from tasks.enable_segment_to_index_task import enable_segment_to_index_task
from tasks.enable_segments_to_index_task import _enable_segments, enable_segments_to_index_task
from tasks.segment_status_task_support import enqueue_current_segment_repairs

disable_segments_module = import_module("tasks.disable_segments_from_index_task")
enable_segments_module = import_module("tasks.enable_segments_to_index_task")
_GENERATION = "2b31ff86-bc59-4a07-8d9c-5fb40ba34269"


class _SegmentStatusTask(Protocol):
    def run(self, *args: object, **kwargs: object) -> object: ...


class LeaseStub:
    token = "lease-token"

    def assert_owned(self) -> None:
        return None

    def renew(self) -> bool:
        return True

    def release(self) -> bool:
        return True


class LockStub:
    def hold(self, *_args: object, **_kwargs: object) -> nullcontext[LeaseStub]:
        return nullcontext(LeaseStub())


def _recovered_execution() -> KnowledgeTaskExecutionLease:
    return KnowledgeTaskExecutionLease(
        intent_id=None,
        execution_id=None,
        store=None,
        clock=datetime.now,
        lease_seconds=300,
        assert_admitted=None,
        recovered_execution=True,
    )


@pytest.fixture(autouse=True)
def _status_task_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(enable_segments_module, "_indexing_lock", lambda: LockStub())
    monkeypatch.setattr(disable_segments_module, "_indexing_lock", lambda: LockStub())
    monkeypatch.setattr(
        enable_segments_module,
        "knowledge_task_execution",
        lambda _intent_id: nullcontext(KnowledgeTaskExecutionLease.untracked()),
    )
    monkeypatch.setattr(
        disable_segments_module,
        "knowledge_task_execution",
        lambda _intent_id: nullcontext(KnowledgeTaskExecutionLease.untracked()),
    )
    monkeypatch.setattr(enable_segments_module, "enqueue_current_segment_repairs", lambda **_kwargs: None)
    monkeypatch.setattr(disable_segments_module, "enqueue_current_segment_repairs", lambda **_kwargs: None)


def _set_status_intent(
    session: Session,
    segment: DocumentSegment,
    *,
    enabled: bool,
) -> str:
    segment.enabled = enabled
    segment.status = SegmentStatus.INDEXING
    segment.indexing_at = datetime(2026, 10, 19, 12, 0, 0)
    segment.indexing_generation = _GENERATION
    session.commit()
    return _GENERATION


@pytest.mark.parametrize(
    ("task_module", "task", "expected_enabled"),
    [
        (enable_segments_module, enable_segments_to_index_task, True),
        (disable_segments_module, disable_segments_from_index_task, False),
    ],
)
def test_recovered_segment_status_execution_persists_current_repair_before_exit(
    monkeypatch: pytest.MonkeyPatch,
    task_module: object,
    task: _SegmentStatusTask,
    expected_enabled: bool,
) -> None:
    repairs: list[dict[str, object]] = []
    monkeypatch.setattr(
        task_module,
        "knowledge_task_execution",
        lambda _intent_id: nullcontext(_recovered_execution()),
    )
    monkeypatch.setattr(task_module, "enqueue_current_segment_repairs", lambda **kwargs: repairs.append(kwargs))

    task.run(
        ["segment-1"],
        "dataset-1",
        "document-1",
        "intent-1",
        expected_enabled,
        _GENERATION,
    )

    assert repairs == [
        {
            "segment_ids": ["segment-1"],
            "dataset_id": "dataset-1",
            "document_id": "document-1",
        }
    ]


@pytest.fixture
def indexed_segment(sqlite_session: Session) -> tuple[Dataset, Document, DocumentSegment]:
    """Persist the complete owner chain consumed by segment indexing tasks."""
    tenant_id = str(uuid.uuid4())
    created_by = str(uuid.uuid4())
    dataset = Dataset(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Indexing dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
        is_multimodal=False,
    )
    document = Document(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=created_by,
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by=created_by,
        index_node_id="node-1",
        index_node_hash="hash-1",
        status=SegmentStatus.COMPLETED,
    )
    sqlite_session.add_all([dataset, document, segment])
    sqlite_session.commit()
    return dataset, document, segment


@contextmanager
def _record_transaction_events(
    sqlite_session_factory: sessionmaker[Session], phase_events: list[str]
) -> Generator[None]:
    """Record real transaction boundaries from task-owned SQLite sessions."""
    session_type = sqlite_session_factory.class_

    def after_commit(_session: Session) -> None:
        phase_events.append("commit")

    def after_rollback(_session: Session) -> None:
        phase_events.append("rollback")

    event.listen(session_type, "after_commit", after_commit)
    event.listen(session_type, "after_rollback", after_rollback)
    try:
        yield
    finally:
        event.remove(session_type, "after_commit", after_commit)
        event.remove(session_type, "after_rollback", after_rollback)


def test_enable_segment_commits_index_rows_after_loading(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, _document, segment = indexed_segment
    phase_events: list[str] = []
    index_processor = MagicMock()
    index_processor.load.side_effect = lambda *_args, **_kwargs: phase_events.append("load")
    enable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))

    with (
        _record_transaction_events(sqlite_session_factory, phase_events),
        patch("tasks.enable_segment_to_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.enable_summaries_for_segments",
            enable_summaries,
        ),
        patch("tasks.enable_segment_to_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = index_processor
        enable_segment_to_index_task.run(segment.id)

    assert phase_events == ["load", "commit", "summary"]
    enable_summaries.assert_called_once()
    assert enable_summaries.call_args.kwargs["dataset"].id == dataset.id
    assert enable_summaries.call_args.kwargs["segment_ids"] == [segment.id]


def test_enable_segment_rolls_back_before_error_compensation(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _dataset, _document, segment = indexed_segment
    phase_events: list[str] = []
    index_processor = MagicMock()

    def fail_load(*_args: object, **_kwargs: object) -> None:
        phase_events.append("load")
        raise RuntimeError("load failed")

    index_processor.load.side_effect = fail_load

    with (
        _record_transaction_events(sqlite_session_factory, phase_events),
        patch("tasks.enable_segment_to_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.enable_summaries_for_segments"
        ) as enable_summaries,
        patch("tasks.enable_segment_to_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = index_processor
        enable_segment_to_index_task.run(segment.id)

    sqlite_session.expire_all()
    persisted_segment = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted_segment is not None
    assert persisted_segment.enabled is False
    assert persisted_segment.status == SegmentStatus.ERROR
    assert persisted_segment.error == "load failed"
    assert persisted_segment.disabled_at is not None
    assert phase_events == ["load", "rollback", "commit"]
    enable_summaries.assert_not_called()


def test_enable_segments_commits_index_rows_after_loading(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document, segment = indexed_segment
    generation = _set_status_intent(sqlite_session, segment, enabled=True)
    phase_events: list[str] = []
    index_processor = MagicMock()
    index_processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")
    index_processor.load.side_effect = lambda *_args, **_kwargs: phase_events.append("load")
    enable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))

    with (
        _record_transaction_events(sqlite_session_factory, phase_events),
        patch("tasks.enable_segments_to_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.enable_summaries_for_segments",
            enable_summaries,
        ),
        patch("tasks.enable_segments_to_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = index_processor
        enable_segments_to_index_task.run([segment.id], dataset.id, document.id, "intent-1", True, generation)

    assert phase_events == ["clean", "load", "summary", "commit"]
    enable_summaries.assert_called_once()
    assert enable_summaries.call_args.kwargs["dataset"].id == dataset.id
    assert enable_summaries.call_args.kwargs["segment_ids"] == [segment.id]
    index_processor.clean.assert_called_once()


def test_segment_status_tasks_use_late_acknowledgements() -> None:
    assert enable_segments_to_index_task.acks_late is True
    assert enable_segments_to_index_task.reject_on_worker_lost is True
    assert disable_segments_module.disable_segments_from_index_task.acks_late is True
    assert disable_segments_module.disable_segments_from_index_task.reject_on_worker_lost is True


@pytest.mark.parametrize(
    ("task", "expected_enabled", "expected_kind"),
    [
        (enable_segments_to_index_task, True, "segment_index_enable"),
        (disable_segments_from_index_task, False, "segment_index_disable"),
    ],
)
def test_legacy_three_argument_delivery_is_converted_once_to_durable_generation(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    monkeypatch: pytest.MonkeyPatch,
    task: _SegmentStatusTask,
    expected_enabled: bool,
    expected_kind: str,
) -> None:
    import tasks.segment_status_task_support as task_support

    dataset, document, segment = indexed_segment
    segment.enabled = expected_enabled
    segment.indexing_generation = None
    sqlite_session.commit()
    monkeypatch.setattr(task_support, "wake_knowledge_task_dispatcher_after_commit", lambda _session: None)

    task.run([segment.id], dataset.id, document.id)
    task.run([segment.id], dataset.id, document.id)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted is not None
    assert persisted.status == SegmentStatus.INDEXING
    assert persisted.indexing_generation is not None
    intents = sqlite_session.scalars(select(KnowledgeTaskOutbox)).all()
    assert len(intents) == 1
    assert intents[0].task_kind == expected_kind
    assert intents[0].payload == {
        "segment_ids": [segment.id],
        "dataset_id": dataset.id,
        "document_id": document.id,
        "expected_enabled": expected_enabled,
        "generation": persisted.indexing_generation,
    }


def test_economy_segment_status_workers_commit_keyword_table_changes(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import core.rag.datasource.keyword.jieba.jieba as jieba_module

    dataset, document, segment = indexed_segment
    dataset.indexing_technique = IndexTechniqueType.ECONOMY
    enable_generation = _set_status_intent(sqlite_session, segment, enabled=True)

    class KeywordExtractor:
        def extract_keywords(self, _content: str, _limit: int) -> set[str]:
            return {"persisted-keyword"}

    monkeypatch.setattr(jieba_module.redis_client, "lock", lambda *_args, **_kwargs: nullcontext())
    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", KeywordExtractor)

    _enable_segments(
        [segment.id],
        dataset.id,
        document.id,
        0.0,
        generation=enable_generation,
        lease=LeaseStub(),
    )

    sqlite_session.expire_all()
    keyword_row = sqlite_session.scalar(select(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == dataset.id))
    assert keyword_row is not None
    assert json.loads(keyword_row.keyword_table)["__data__"]["table"] == {"persisted-keyword": ["node-1"]}

    disable_generation = str(uuid.uuid4())
    persisted_segment = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted_segment is not None
    persisted_segment.enabled = False
    persisted_segment.status = SegmentStatus.INDEXING
    persisted_segment.indexing_generation = disable_generation
    sqlite_session.commit()

    disable_segments_module._disable_segments(
        [segment.id],
        dataset.id,
        document.id,
        0.0,
        generation=disable_generation,
        lease=LeaseStub(),
    )

    sqlite_session.expire_all()
    keyword_row = sqlite_session.scalar(select(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == dataset.id))
    assert keyword_row is not None
    assert json.loads(keyword_row.keyword_table)["__data__"]["table"] == {}


@pytest.mark.parametrize(
    ("task", "expected_enabled"),
    [
        (enable_segments_to_index_task, True),
        (disable_segments_module.disable_segments_from_index_task, False),
    ],
)
def test_exhausted_status_worker_marks_only_matching_generation_error(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    task: object,
    expected_enabled: bool,
) -> None:
    dataset, document, segment = indexed_segment
    generation = _set_status_intent(sqlite_session, segment, enabled=expected_enabled)

    task.on_failure(  # type: ignore[attr-defined]
        RuntimeError("provider unavailable"),
        "task-1",
        ([segment.id], dataset.id, document.id, "intent-1", expected_enabled, generation),
        {},
        None,
    )

    sqlite_session.expire_all()
    persisted = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted is not None
    assert persisted.enabled is expected_enabled
    assert persisted.status == SegmentStatus.ERROR
    assert persisted.error == "provider unavailable"


def test_durably_requeued_status_worker_keeps_generation_retryable(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
) -> None:
    dataset, document, segment = indexed_segment
    generation = _set_status_intent(sqlite_session, segment, enabled=True)

    enable_segments_to_index_task.on_failure(
        KnowledgeTaskRequeuedError("durably requeued"),
        "task-1",
        ([segment.id], dataset.id, document.id, "intent-1", True, generation),
        {},
        None,
    )

    sqlite_session.expire_all()
    persisted = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted is not None
    assert persisted.status == SegmentStatus.INDEXING
    assert persisted.error is None


def test_lost_execution_cannot_mark_completed_successor_as_failed(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
) -> None:
    dataset, document, segment = indexed_segment
    generation = _set_status_intent(sqlite_session, segment, enabled=True)
    segment.status = SegmentStatus.COMPLETED
    sqlite_session.commit()

    enable_segments_to_index_task.on_failure(
        KnowledgeTaskExecutionLeaseLostError("execution was reclaimed"),
        "stale-task",
        ([segment.id], dataset.id, document.id, "intent-1", True, generation),
        {},
        None,
    )

    sqlite_session.expire_all()
    persisted = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted is not None
    assert persisted.status == SegmentStatus.COMPLETED
    assert persisted.error is None


@pytest.mark.parametrize(
    ("task", "expected_enabled"),
    [
        (enable_segments_to_index_task, True),
        (disable_segments_module.disable_segments_from_index_task, False),
    ],
)
@pytest.mark.parametrize("unavailable_state", ["archived", "disabled", "paused", "error"])
def test_permanently_unavailable_document_marks_matching_generation_error(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    task: object,
    expected_enabled: bool,
    unavailable_state: str,
) -> None:
    dataset, document, segment = indexed_segment
    generation = _set_status_intent(sqlite_session, segment, enabled=expected_enabled)
    if unavailable_state == "archived":
        document.archived = True
    elif unavailable_state == "disabled":
        document.enabled = False
    elif unavailable_state == "paused":
        document.indexing_status = IndexingStatus.PAUSED
    else:
        document.indexing_status = IndexingStatus.ERROR
    sqlite_session.commit()
    args = ([segment.id], dataset.id, document.id, "intent-1", expected_enabled, generation)

    with pytest.raises(KnowledgeTaskPermanentError) as caught:
        task.run(*args)  # type: ignore[attr-defined]
    task.on_failure(caught.value, "task-1", args, {}, None)  # type: ignore[attr-defined]

    sqlite_session.expire_all()
    persisted = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted is not None
    assert persisted.status == SegmentStatus.ERROR
    assert persisted.error == f"Document {document.id} cannot be indexed in its current state"


@pytest.mark.parametrize(
    ("task", "expected_enabled"),
    [
        (enable_segments_to_index_task, True),
        (disable_segments_module.disable_segments_from_index_task, False),
    ],
)
@pytest.mark.parametrize("transient_state", [IndexingStatus.WAITING, IndexingStatus.PARSING])
def test_temporarily_unavailable_document_keeps_generation_retryable(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    task: object,
    expected_enabled: bool,
    transient_state: IndexingStatus,
) -> None:
    dataset, document, segment = indexed_segment
    generation = _set_status_intent(sqlite_session, segment, enabled=expected_enabled)
    document.indexing_status = transient_state
    sqlite_session.commit()

    with pytest.raises(RuntimeError, match="unavailable for segment indexing"):
        task.run(  # type: ignore[attr-defined]
            [segment.id],
            dataset.id,
            document.id,
            "intent-1",
            expected_enabled,
            generation,
        )

    sqlite_session.expire_all()
    persisted = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted is not None
    assert persisted.status == SegmentStatus.INDEXING
    assert persisted.error is None


def test_exhausted_stale_worker_cannot_overwrite_new_generation(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
) -> None:
    dataset, document, segment = indexed_segment
    old_generation = _set_status_intent(sqlite_session, segment, enabled=False)
    segment.indexing_generation = "87de1684-f2f1-4485-9a86-89351bf6b5a5"
    sqlite_session.commit()

    disable_segments_module.disable_segments_from_index_task.on_failure(
        RuntimeError("old failure"),
        "task-1",
        ([segment.id], dataset.id, document.id, "intent-1", False, old_generation),
        {},
        None,
    )

    sqlite_session.expire_all()
    persisted = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted is not None
    assert persisted.status == SegmentStatus.INDEXING
    assert persisted.error is None


def test_expired_disable_late_clean_converges_via_persisted_current_generation_repair(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import tasks.segment_status_task_support as task_support
    from services.knowledge.summaries.adapters import SummaryIndexAdapter

    dataset, document, segment = indexed_segment
    old_generation = _set_status_intent(sqlite_session, segment, enabled=False)
    new_generation = "87de1684-f2f1-4485-9a86-89351bf6b5a5"
    indexed_nodes = {"node-1"}

    class LosingLease(LeaseStub):
        def __init__(self) -> None:
            self.assertions = 0

        @override
        def assert_owned(self) -> None:
            self.assertions += 1
            if self.assertions > 1:
                raise KnowledgeIndexingLeaseLostError("lease expired")

    class LosingLock:
        def hold(self, *_args: object, **_kwargs: object) -> nullcontext[LosingLease]:
            return nullcontext(LosingLease())

    class LateDisableProcessor:
        def clean(self, *_args: object, **kwargs: object) -> None:
            session = kwargs["session"]
            assert isinstance(session, Session)
            current = session.get(DocumentSegment, segment.id)
            assert current is not None
            # A newer enable wins the database race and loads its vector while
            # this expired disable call is still in flight.
            current.enabled = True
            current.status = SegmentStatus.COMPLETED
            current.indexing_generation = new_generation
            session.commit()
            indexed_nodes.add("node-1")
            # The old external clean returns last and removes the newer vector.
            indexed_nodes.discard("node-1")

    class EnableRepairProcessor:
        def clean(self, *_args: object, **_kwargs: object) -> None:
            indexed_nodes.discard("node-1")

        def load(self, *_args: object, **_kwargs: object) -> None:
            indexed_nodes.add("node-1")

    class Factory:
        processor: object = LateDisableProcessor()

        def __init__(self, _doc_form: str, **_kwargs: object) -> None:
            pass

        def init_index_processor(self) -> object:
            return self.processor

    monkeypatch.setattr(disable_segments_module, "_indexing_lock", lambda: LosingLock())
    monkeypatch.setattr(disable_segments_module, "IndexProcessorFactory", Factory)
    monkeypatch.setattr(disable_segments_module, "enqueue_current_segment_repairs", enqueue_current_segment_repairs)
    monkeypatch.setattr(task_support, "wake_knowledge_task_dispatcher_after_commit", lambda _session: None)
    monkeypatch.setattr(SummaryIndexAdapter, "enable_summaries_for_segments", lambda **_kwargs: None)

    with pytest.raises(Exception, match="lease expired"):
        disable_segments_module.disable_segments_from_index_task.run(
            [segment.id], dataset.id, document.id, "old-intent", False, old_generation
        )

    assert indexed_nodes == set()
    with sqlite_session_factory() as session:
        repair = session.scalar(
            select(KnowledgeTaskOutbox)
            .where(KnowledgeTaskOutbox.task_kind == "segment_index_enable")
            .order_by(KnowledgeTaskOutbox.created_at.desc())
        )
        assert repair is not None
        assert "repair" not in repair.payload
        assert repair.payload["generation"] == new_generation

    Factory.processor = EnableRepairProcessor()
    monkeypatch.setattr(enable_segments_module, "IndexProcessorFactory", Factory)
    _enable_segments(
        [segment.id],
        dataset.id,
        document.id,
        0.0,
        generation=new_generation,
        lease=LeaseStub(),
    )

    assert indexed_nodes == {"node-1"}
    sqlite_session.expire_all()
    persisted = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted is not None
    assert persisted.enabled is True
    assert persisted.status == SegmentStatus.COMPLETED


def test_redelivered_stale_intent_persists_repair_for_current_generation(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import tasks.segment_status_task_support as task_support

    dataset, document, segment = indexed_segment
    segment.enabled = True
    segment.status = SegmentStatus.COMPLETED
    segment.indexing_generation = "87de1684-f2f1-4485-9a86-89351bf6b5a5"
    sqlite_session.commit()
    monkeypatch.setattr(disable_segments_module, "enqueue_current_segment_repairs", enqueue_current_segment_repairs)
    monkeypatch.setattr(task_support, "wake_knowledge_task_dispatcher_after_commit", lambda _session: None)

    disable_segments_module.disable_segments_from_index_task.run(
        [segment.id],
        dataset.id,
        document.id,
        "redelivered-old-intent",
        False,
        _GENERATION,
    )

    with sqlite_session_factory() as session:
        repair = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "segment_index_enable")
        )
        assert repair is not None
        assert "repair" not in repair.payload
        assert repair.payload["generation"] == segment.indexing_generation


def test_parent_child_multimodal_disable_cleans_child_and_attachment_vectors_separately(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from services.knowledge.summaries.adapters import SummaryIndexAdapter

    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    document.doc_form = IndexStructureType.PARENT_CHILD_INDEX
    generation = _set_status_intent(sqlite_session, segment, enabled=False)
    child = ChildChunk(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        position=1,
        content="child",
        word_count=1,
        created_by=segment.created_by,
        index_node_id="child-node",
        index_node_hash="child-hash",
    )
    binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        attachment_id="attachment-node",
    )
    sqlite_session.add_all([child, binding])
    sqlite_session.commit()
    indexed_nodes = {"child-node", "attachment-node"}
    processor_calls: list[list[str]] = []
    attachment_calls: list[list[str]] = []

    class ParentChildProcessor:
        def clean(self, _dataset: Dataset, node_ids: list[str], **kwargs: object) -> None:
            processor_calls.append(node_ids)
            assert kwargs["delete_child_chunks"] is False
            indexed_nodes.discard("child-node")

    class Factory:
        def __init__(self, _doc_form: str, **_kwargs: object) -> None:
            pass

        def init_index_processor(self) -> ParentChildProcessor:
            return ParentChildProcessor()

    class AttachmentVector:
        def __init__(self, _dataset: Dataset, *, session: Session) -> None:
            del session

        def delete_by_ids(self, ids: list[str]) -> None:
            attachment_calls.append(ids)
            indexed_nodes.difference_update(ids)

    monkeypatch.setattr(disable_segments_module, "IndexProcessorFactory", Factory)
    monkeypatch.setattr(disable_segments_module, "Vector", AttachmentVector)
    monkeypatch.setattr(SummaryIndexAdapter, "disable_summaries_for_segments", lambda **_kwargs: None)

    disable_segments_module._disable_segments(
        [segment.id],
        dataset.id,
        document.id,
        0.0,
        generation=generation,
        lease=LeaseStub(),
    )

    assert processor_calls == [["node-1"]]
    assert attachment_calls == [["attachment-node"]]
    assert indexed_nodes == set()
    sqlite_session.expire_all()
    assert sqlite_session.get(ChildChunk, child.id) is not None


def test_disable_preserves_attachment_vector_used_by_another_active_segment(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    generation = _set_status_intent(sqlite_session, segment, enabled=False)
    other_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=2,
        content="other",
        word_count=1,
        tokens=1,
        created_by=segment.created_by,
        index_node_id="other-node",
        index_node_hash="other-hash",
        enabled=True,
        status=SegmentStatus.COMPLETED,
    )
    target_binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        attachment_id="shared-attachment",
    )
    active_binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=other_segment.id,
        attachment_id="shared-attachment",
    )
    sqlite_session.add_all([other_segment, target_binding, active_binding])
    sqlite_session.commit()

    cleaned_nodes: list[list[str]] = []
    deleted_attachments: list[list[str]] = []

    class Processor:
        def clean(self, _dataset: Dataset, node_ids: list[str], **_kwargs: object) -> None:
            cleaned_nodes.append(node_ids)

    class Factory:
        def __init__(self, _doc_form: str, **_kwargs: object) -> None:
            pass

        def init_index_processor(self) -> Processor:
            return Processor()

    class AttachmentVector:
        def __init__(self, _dataset: Dataset, *, session: Session) -> None:
            del session

        def delete_by_ids(self, ids: list[str]) -> None:
            deleted_attachments.append(ids)

    monkeypatch.setattr(disable_segments_module, "IndexProcessorFactory", Factory)
    monkeypatch.setattr(disable_segments_module, "Vector", AttachmentVector)
    monkeypatch.setattr(SummaryIndexAdapter, "disable_summaries_for_segments", lambda **_kwargs: None)

    disable_segments_module._disable_segments(
        [segment.id],
        dataset.id,
        document.id,
        0.0,
        generation=generation,
        lease=LeaseStub(),
    )

    assert cleaned_nodes == [[segment.index_node_id]]
    assert deleted_attachments == []


def test_enable_segments_skips_segments_that_are_not_completed(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
) -> None:
    """A batch enable must not push a segment that never finished indexing."""
    dataset, document, segment = indexed_segment
    segment.status = SegmentStatus.ERROR
    segment.enabled = False
    sqlite_session.commit()

    index_processor = MagicMock()

    with (
        patch("tasks.enable_segments_to_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.enable_summaries_for_segments"
        ) as enable_summaries,
        patch("tasks.enable_segments_to_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = index_processor
        enable_segments_to_index_task.run([segment.id], dataset.id, document.id, "intent-1", True, _GENERATION)

    index_processor.load.assert_not_called()
    enable_summaries.assert_not_called()


def test_enable_segments_failure_preserves_requested_status_for_retry(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document, segment = indexed_segment
    generation = _set_status_intent(sqlite_session, segment, enabled=True)
    phase_events: list[str] = []
    index_processor = MagicMock()
    index_processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")

    def fail_load(*_args: object, **_kwargs: object) -> None:
        phase_events.append("load")
        raise RuntimeError("load failed")

    index_processor.load.side_effect = fail_load

    with (
        _record_transaction_events(sqlite_session_factory, phase_events),
        patch("tasks.enable_segments_to_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.enable_summaries_for_segments"
        ) as enable_summaries,
    ):
        processor_factory.return_value.init_index_processor.return_value = index_processor
        with pytest.raises(RuntimeError, match="load failed"):
            _enable_segments(
                [segment.id],
                dataset.id,
                document.id,
                0.0,
                generation=generation,
                lease=LeaseStub(),
            )

    sqlite_session.expire_all()
    persisted_segment = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted_segment is not None
    assert persisted_segment.enabled is True
    assert persisted_segment.status == SegmentStatus.INDEXING
    assert persisted_segment.error is None
    assert persisted_segment.disabled_at is None
    assert phase_events == ["clean", "load"]
    enable_summaries.assert_not_called()


def test_enable_segments_retries_summary_restore_before_marking_segment_completed(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    generation = _set_status_intent(sqlite_session, segment, enabled=True)
    summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content="summary",
        status=SummaryStatus.COMPLETED,
        enabled=False,
    )
    sqlite_session.add(summary)
    sqlite_session.commit()

    class Processor:
        def clean(self, *_args: object, **_kwargs: object) -> None:
            return None

        def load(self, *_args: object, **_kwargs: object) -> None:
            return None

    class Factory:
        def __init__(self, _doc_form: str, **_kwargs: object) -> None:
            pass

        def init_index_processor(self) -> Processor:
            return Processor()

    monkeypatch.setattr(enable_segments_module, "IndexProcessorFactory", Factory)
    summary_attempts: list[tuple[str, str]] = []

    def fail_summary(
        _summary: DocumentSegmentSummary,
        _segment: DocumentSegment,
        _dataset: Dataset,
        session: Session | None = None,
        *,
        fence: SummaryWriteFence | None = None,
    ) -> None:
        assert session is not None
        assert fence is not None
        summary_attempts.append(("failed", fence.expected_segment_status))
        raise RuntimeError("summary provider unavailable")

    monkeypatch.setattr(SummaryIndexAdapter, "vectorize_summary", fail_summary)

    with pytest.raises(RuntimeError, match="Failed to restore summary indexes"):
        _enable_segments(
            [segment.id],
            dataset.id,
            document.id,
            0.0,
            generation=generation,
            lease=LeaseStub(),
        )

    sqlite_session.expire_all()
    persisted_segment = sqlite_session.get(DocumentSegment, segment.id)
    persisted_summary = sqlite_session.get(DocumentSegmentSummary, summary.id)
    assert persisted_segment is not None
    assert persisted_summary is not None
    assert persisted_segment.status == SegmentStatus.INDEXING
    assert persisted_summary.enabled is False
    persisted_segment.status = SegmentStatus.ERROR
    sqlite_session.commit()

    def complete_summary(
        summary_record: DocumentSegmentSummary,
        _segment: DocumentSegment,
        _dataset: Dataset,
        session: Session | None = None,
        *,
        fence: SummaryWriteFence | None = None,
    ) -> None:
        assert session is not None
        assert fence is not None
        summary_attempts.append(("completed", fence.expected_segment_status))
        summary_record.status = SummaryStatus.COMPLETED
        summary_record.error = None

    monkeypatch.setattr(SummaryIndexAdapter, "vectorize_summary", complete_summary)
    _enable_segments(
        [segment.id],
        dataset.id,
        document.id,
        0.0,
        generation=generation,
        lease=LeaseStub(),
    )

    sqlite_session.expire_all()
    persisted_segment = sqlite_session.get(DocumentSegment, segment.id)
    persisted_summary = sqlite_session.get(DocumentSegmentSummary, summary.id)
    assert persisted_segment is not None
    assert persisted_summary is not None
    assert persisted_segment.status == SegmentStatus.COMPLETED
    assert persisted_summary.enabled is True
    assert summary_attempts == [
        ("failed", SegmentStatus.INDEXING),
        ("completed", SegmentStatus.ERROR),
    ]


def test_enable_segments_skips_stale_intent_after_segment_was_disabled(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment = indexed_segment
    segment.enabled = False
    sqlite_session.commit()

    class Processor:
        calls = 0

        def load(self, *_args: object, **_kwargs: object) -> None:
            self.calls += 1

    processor = Processor()

    class Factory:
        def __init__(self, _doc_form: str, **_kwargs: object) -> None:
            pass

        def init_index_processor(self) -> Processor:
            return processor

    monkeypatch.setattr(enable_segments_module, "IndexProcessorFactory", Factory)

    enable_segments_to_index_task.run([segment.id], dataset.id, document.id, "intent-1", True, _GENERATION)

    assert processor.calls == 0


def test_disable_segments_skips_stale_intent_after_segment_was_enabled(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment = indexed_segment

    class Processor:
        calls = 0

        def clean(self, *_args: object, **_kwargs: object) -> None:
            self.calls += 1

    processor = Processor()

    class Factory:
        def __init__(self, _doc_form: str, **_kwargs: object) -> None:
            pass

        def init_index_processor(self) -> Processor:
            return processor

    monkeypatch.setattr(disable_segments_module, "IndexProcessorFactory", Factory)

    disable_segments_module.disable_segments_from_index_task.run(
        [segment.id], dataset.id, document.id, "intent-1", False, _GENERATION
    )

    assert processor.calls == 0


def test_disable_segments_failure_preserves_requested_status_for_retry(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment = indexed_segment
    segment.enabled = False
    segment.disabled_by = "editor"
    generation = _set_status_intent(sqlite_session, segment, enabled=False)

    class Processor:
        def clean(self, *_args: object, **_kwargs: object) -> None:
            raise RuntimeError("clean failed")

    processor = Processor()

    class Factory:
        def __init__(self, _doc_form: str, **_kwargs: object) -> None:
            pass

        def init_index_processor(self) -> Processor:
            return processor

    monkeypatch.setattr(disable_segments_module, "IndexProcessorFactory", Factory)

    with pytest.raises(RuntimeError, match="clean failed"):
        disable_segments_module._disable_segments(
            [segment.id],
            dataset.id,
            document.id,
            0.0,
            generation=generation,
            lease=LeaseStub(),
        )

    sqlite_session.expire_all()
    persisted_segment = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted_segment is not None
    assert persisted_segment.enabled is False
    assert persisted_segment.disabled_by == "editor"
    assert persisted_segment.status == SegmentStatus.INDEXING


@pytest.mark.parametrize("owner_field", ["dataset_id", "tenant_id"])
@pytest.mark.parametrize(
    ("task_module", "task"),
    [
        (enable_segments_module, enable_segments_to_index_task),
        (disable_segments_module, disable_segments_from_index_task),
    ],
)
def test_segment_status_tasks_skip_document_from_another_owner(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    monkeypatch: pytest.MonkeyPatch,
    owner_field: str,
    task_module: object,
    task: _SegmentStatusTask,
) -> None:
    dataset, document, segment = indexed_segment
    setattr(document, owner_field, str(uuid.uuid4()))
    sqlite_session.commit()

    class Factory:
        calls = 0

        def __init__(self, _doc_form: str, **_kwargs: object) -> None:
            type(self).calls += 1

    monkeypatch.setattr(task_module, "IndexProcessorFactory", Factory)

    expected_enabled = task_module is enable_segments_module
    task.run(
        [segment.id],
        dataset.id,
        document.id,
        "intent-1",
        expected_enabled,
        _GENERATION,
    )

    assert Factory.calls == 0


@pytest.mark.parametrize(
    ("task_module", "task"),
    [
        (enable_segments_module, enable_segments_to_index_task),
        (disable_segments_module, disable_segments_from_index_task),
    ],
)
def test_segment_status_tasks_skip_segment_from_another_tenant(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    monkeypatch: pytest.MonkeyPatch,
    task_module: object,
    task: _SegmentStatusTask,
) -> None:
    dataset, document, segment = indexed_segment
    segment.tenant_id = str(uuid.uuid4())
    if task_module is disable_segments_module:
        segment.enabled = False
    sqlite_session.commit()

    class Processor:
        calls = 0

        def clean(self, *_args: object, **_kwargs: object) -> None:
            self.calls += 1

        def load(self, *_args: object, **_kwargs: object) -> None:
            self.calls += 1

    processor = Processor()

    class Factory:
        def __init__(self, _doc_form: str, **_kwargs: object) -> None:
            pass

        def init_index_processor(self) -> Processor:
            return processor

    monkeypatch.setattr(task_module, "IndexProcessorFactory", Factory)

    expected_enabled = task_module is enable_segments_module
    task.run(
        [segment.id],
        dataset.id,
        document.id,
        "intent-1",
        expected_enabled,
        _GENERATION,
    )

    assert processor.calls == 0
