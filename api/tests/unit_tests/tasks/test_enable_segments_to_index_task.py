"""Current segment indexing transactions, without retired delivery generations."""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError, KnowledgeIndexingLockBusyError
from tasks.enable_segment_to_index_task import enable_segment_to_index_task
from tasks.enable_segments_to_index_task import SEGMENT_INDEX_MAX_RETRIES, enable_segments_to_index_task
from tasks.indexing_task_retry import LOCK_BUSY_RETRY_MAX_SECONDS, TaskRetriesExhaustedError


class _LoadProbe:
    def __init__(self) -> None:
        self.called = False

    def load(self, *_args: object, **_kwargs: object) -> None:
        self.called = True


class _IndexProcessorFactoryStub:
    def __init__(self, processor: _LoadProbe) -> None:
        self._processor = processor

    def init_index_processor(self) -> _LoadProbe:
        return self._processor


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
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document, segment = indexed_segment
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
        enable_segments_to_index_task.run([segment.id], dataset.id, document.id)

    assert phase_events == ["load", "commit", "summary"]
    enable_summaries.assert_called_once()
    assert enable_summaries.call_args.kwargs["dataset"].id == dataset.id
    assert enable_summaries.call_args.kwargs["segment_ids"] == [segment.id]
    index_processor.clean.assert_not_called()


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
        enable_segments_to_index_task.run([segment.id], dataset.id, document.id)

    index_processor.load.assert_not_called()
    enable_summaries.assert_not_called()


def test_late_enable_delivery_skips_segment_restored_after_publish_failure(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
) -> None:
    dataset, document, segment = indexed_segment
    segment.enabled = False
    sqlite_session.commit()
    index_processor = _LoadProbe()

    def unexpected_summary(**_kwargs: object) -> None:
        raise AssertionError("A stale enable must not update summaries")

    with (
        patch(
            "tasks.enable_segments_to_index_task.IndexProcessorFactory",
            new=lambda _doc_form: _IndexProcessorFactoryStub(index_processor),
        ),
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.enable_summaries_for_segments",
            new=unexpected_summary,
        ),
    ):
        enable_segments_to_index_task.run([segment.id], dataset.id, document.id)

    assert index_processor.called is False


class _OwnedLease:
    def assert_owned(self) -> None:
        return None


class _ScriptedLocks:
    """Fail the first ``hold`` calls with the scripted errors, then grant the lease."""

    def __init__(self, *errors: Exception) -> None:
        self._errors = list(errors)
        self.attempts = 0

    @contextmanager
    def hold(self, _name: str, *, timeout: int, blocking_timeout: float) -> Generator[_OwnedLease]:
        del timeout, blocking_timeout
        self.attempts += 1
        if self._errors:
            raise self._errors.pop(0)
        yield _OwnedLease()


def test_enable_segments_waits_for_a_busy_index_lock_beyond_the_bounded_retry_budget() -> None:
    locks = _ScriptedLocks(KnowledgeIndexingLockBusyError("busy"), KnowledgeIndexingLockBusyError("busy"))
    with (
        patch("tasks.enable_segments_to_index_task.RedisKnowledgeIndexingLock", return_value=locks),
        patch("tasks.enable_segments_to_index_task._enable_segments_to_index") as enable,
        patch("tasks.enable_segments_to_index_task.redis_client.delete") as clear_cache,
        patch.object(enable_segments_to_index_task, "retry", wraps=enable_segments_to_index_task.retry) as retry,
    ):
        # Far beyond the old five-retry limit: indexing may hold this lock for a long time.
        result = enable_segments_to_index_task.apply(
            args=(["segment-1"], "dataset-1", "document-1"),
            retries=500,
            throw=False,
        )

    assert result.state == "SUCCESS"
    assert locks.attempts == 3
    enable.assert_called_once()
    # Capped backoff, and no per-call max_retries override that Celery would leak to later failures.
    assert [call.kwargs["countdown"] for call in retry.call_args_list] == [
        LOCK_BUSY_RETRY_MAX_SECONDS,
        LOCK_BUSY_RETRY_MAX_SECONDS,
    ]
    assert all("max_retries" not in call.kwargs for call in retry.call_args_list)
    # The flag is cleared once, by the attempt that finally ran.
    clear_cache.assert_called_once_with("segment_segment-1_indexing")


def test_enable_segments_keeps_indexing_flags_while_a_lease_loss_will_be_retried() -> None:
    locks = _ScriptedLocks(KnowledgeIndexingLeaseLostError("lost"))

    with (
        patch("tasks.enable_segments_to_index_task.RedisKnowledgeIndexingLock", return_value=locks),
        patch("tasks.enable_segments_to_index_task.redis_client.delete") as clear_cache,
        pytest.raises(KnowledgeIndexingLeaseLostError),
    ):
        enable_segments_to_index_task.run(["segment-1"], "dataset-1", "document-1")

    clear_cache.assert_not_called()


def test_enable_segments_clears_indexing_flags_when_retries_are_exhausted() -> None:
    locks = _ScriptedLocks(KnowledgeIndexingLeaseLostError("lost"))

    enable_segments_to_index_task.push_request(retries=SEGMENT_INDEX_MAX_RETRIES)
    try:
        with (
            patch("tasks.enable_segments_to_index_task.RedisKnowledgeIndexingLock", return_value=locks),
            patch("tasks.enable_segments_to_index_task.redis_client.delete") as clear_cache,
            pytest.raises(TaskRetriesExhaustedError) as raised,
        ):
            enable_segments_to_index_task.run(["segment-1", "segment-2"], "dataset-1", "document-1")
    finally:
        enable_segments_to_index_task.pop_request()

    assert isinstance(raised.value.__cause__, KnowledgeIndexingLeaseLostError)
    assert [call.args[0] for call in clear_cache.call_args_list] == [
        "segment_segment-1_indexing",
        "segment_segment-2_indexing",
    ]


def test_enable_segments_clears_indexing_flags_when_a_stale_delivery_is_skipped(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
) -> None:
    dataset, document, segment = indexed_segment
    document.enabled = False
    sqlite_session.commit()

    with (
        patch("tasks.enable_segments_to_index_task.RedisKnowledgeIndexingLock", return_value=_ScriptedLocks()),
        patch("tasks.enable_segments_to_index_task.redis_client.delete") as clear_cache,
    ):
        enable_segments_to_index_task.run([segment.id], dataset.id, document.id)

    # Skipping is a terminal exit too; the flag must not linger for its TTL.
    clear_cache.assert_called_once_with(f"segment_{segment.id}_indexing")
