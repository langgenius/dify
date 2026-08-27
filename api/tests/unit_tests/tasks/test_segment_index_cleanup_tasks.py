import uuid
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.model import UploadFile
from tasks.delete_segment_from_index_task import delete_segment_from_index_task
from tasks.disable_segment_from_index_task import disable_segment_from_index_task
from tasks.disable_segments_from_index_task import disable_segments_from_index_task


@pytest.fixture
def indexed_segment(sqlite_session: Session) -> tuple[Dataset, Document, DocumentSegment]:
    """Persist the complete owner chain consumed by segment cleanup tasks."""
    tenant_id = str(uuid.uuid4())
    created_by = str(uuid.uuid4())
    dataset = Dataset(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Cleanup dataset",
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
        disabled_by=created_by,
        status=SegmentStatus.COMPLETED,
    )
    sqlite_session.add_all([dataset, document, segment])
    sqlite_session.commit()
    return dataset, document, segment


@contextmanager
def _record_transaction_events(
    sqlite_session_factory: sessionmaker[Session], phase_events: list[str]
) -> Generator[None]:
    """Record real commits made by the task-owned SQLite session."""
    session_type = sqlite_session_factory.class_

    def after_commit(_session: Session) -> None:
        phase_events.append("commit")

    event.listen(session_type, "after_commit", after_commit)
    try:
        yield
    finally:
        event.remove(session_type, "after_commit", after_commit)


def test_disable_segment_commits_index_cleanup(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, _document, segment = indexed_segment
    phase_events: list[str] = []
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")
    disable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))

    with (
        _record_transaction_events(sqlite_session_factory, phase_events),
        patch("tasks.disable_segment_from_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.summary_index_service.SummaryIndexService.disable_summaries_for_segments",
            disable_summaries,
        ),
        patch("tasks.disable_segment_from_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        disable_segment_from_index_task.run(segment.id)

    assert phase_events == ["clean", "commit", "summary"]
    disable_summaries.assert_called_once()
    assert disable_summaries.call_args.kwargs["dataset"].id == dataset.id
    assert disable_summaries.call_args.kwargs["segment_ids"] == [segment.id]
    assert disable_summaries.call_args.kwargs["disabled_by"] == segment.disabled_by


def test_disable_segments_commits_index_cleanup(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document, segment = indexed_segment
    phase_events: list[str] = []
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")
    disable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))

    with (
        _record_transaction_events(sqlite_session_factory, phase_events),
        patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.summary_index_service.SummaryIndexService.disable_summaries_for_segments",
            disable_summaries,
        ),
        patch("tasks.disable_segments_from_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        disable_segments_from_index_task.run([segment.id], dataset.id, document.id)

    assert phase_events == ["clean", "commit", "summary"]
    disable_summaries.assert_called_once()
    assert disable_summaries.call_args.kwargs["dataset"].id == dataset.id
    assert disable_summaries.call_args.kwargs["segment_ids"] == [segment.id]
    assert disable_summaries.call_args.kwargs["disabled_by"] == segment.disabled_by


def test_delete_segment_commits_index_cleanup_without_attachments(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document, segment = indexed_segment
    phase_events: list[str] = []
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")

    with (
        _record_transaction_events(sqlite_session_factory, phase_events),
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    assert phase_events == ["clean", "commit"]


def test_delete_segment_removes_attachment_blobs_from_storage(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/segment-image.png",
        name="segment-image.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=segment.created_by,
        created_at=datetime.now(UTC),
        used=True,
    )
    binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        attachment_id=attachment.id,
    )
    sqlite_session.add_all([dataset, attachment, binding])
    sqlite_session.commit()
    attachment_id = attachment.id
    attachment_key = attachment.key
    binding_id = binding.id

    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.delete_segment_from_index_task.storage.delete") as storage_delete,
    ):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    storage_delete.assert_called_once_with(attachment_key)
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None


def test_delete_segment_keeps_database_cleanup_when_attachment_storage_delete_fails(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/failing-segment-image.png",
        name="failing-segment-image.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=segment.created_by,
        created_at=datetime.now(UTC),
        used=True,
    )
    binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        attachment_id=attachment.id,
    )
    sqlite_session.add_all([dataset, attachment, binding])
    sqlite_session.commit()
    attachment_id = attachment.id
    attachment_key = attachment.key
    binding_id = binding.id

    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "tasks.delete_segment_from_index_task.storage.delete",
            side_effect=RuntimeError("storage unavailable"),
        ) as storage_delete,
        caplog.at_level("ERROR", logger="tasks.delete_segment_from_index_task"),
    ):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    storage_delete.assert_called_once_with(attachment_key)
    assert "Failed to delete segment attachment from storage" in caplog.text
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None
