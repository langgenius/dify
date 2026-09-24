import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from tasks.enable_segment_to_index_task import enable_segment_to_index_task
from tasks.enable_segments_to_index_task import enable_segments_to_index_task


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
) -> Iterator[None]:
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
            "services.summary_index_service.SummaryIndexService.enable_summaries_for_segments",
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
        patch("services.summary_index_service.SummaryIndexService.enable_summaries_for_segments") as enable_summaries,
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
    index_processor.load.side_effect = lambda *_args, **_kwargs: phase_events.append("load")
    enable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))

    with (
        _record_transaction_events(sqlite_session_factory, phase_events),
        patch("tasks.enable_segments_to_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.summary_index_service.SummaryIndexService.enable_summaries_for_segments",
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


def test_enable_segments_rolls_back_before_error_compensation(
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document, segment = indexed_segment
    phase_events: list[str] = []
    index_processor = MagicMock()

    def fail_load(*_args: object, **_kwargs: object) -> None:
        phase_events.append("load")
        raise RuntimeError("load failed")

    index_processor.load.side_effect = fail_load

    with (
        _record_transaction_events(sqlite_session_factory, phase_events),
        patch("tasks.enable_segments_to_index_task.IndexProcessorFactory") as processor_factory,
        patch("services.summary_index_service.SummaryIndexService.enable_summaries_for_segments") as enable_summaries,
        patch("tasks.enable_segments_to_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = index_processor
        enable_segments_to_index_task.run([segment.id], dataset.id, document.id)

    sqlite_session.expire_all()
    persisted_segment = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted_segment is not None
    assert persisted_segment.enabled is False
    assert persisted_segment.status == SegmentStatus.ERROR
    assert persisted_segment.error == "load failed"
    assert persisted_segment.disabled_at is not None
    assert phase_events == ["load", "rollback", "commit"]
    enable_summaries.assert_not_called()
