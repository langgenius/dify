import logging
import uuid
from collections.abc import Generator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from psycopg2.errors import LockNotAvailable
from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from enums.creator import CreatorUserRole
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary, SegmentAttachmentBinding
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus, SummaryStatus
from models.model import UploadFile
from services.entities.upload_file import UploadFileReferenceCandidate
from services.knowledge.indexing.contracts import pending_upload_cleanup_ids
from tasks.delete_segment_from_index_task import delete_segment_from_index_task
from tasks.disable_segment_from_index_task import disable_segment_from_index_task
from tasks.disable_segments_from_index_task import _disable_segments_from_index, disable_segments_from_index_task


class _OwnedLease:
    @property
    def token(self) -> str:
        return "owned"

    def assert_owned(self) -> None:
        pass

    def renew(self) -> bool:
        return True

    def release(self) -> bool:
        return True


class _CleanProbe:
    def __init__(self) -> None:
        self.called = False

    def clean(self, *_args: object, **_kwargs: object) -> None:
        self.called = True


class _IndexProcessorFactoryStub:
    def __init__(self, processor: _CleanProbe) -> None:
        self._processor = processor

    def init_index_processor(self) -> _CleanProbe:
        return self._processor


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
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.disable_summaries_for_segments",
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
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset, document, segment = indexed_segment
    segment.enabled = False
    sqlite_session.commit()
    attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/disabled-segment-image.png",
        name="disabled-segment-image.png",
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
    sqlite_session.add_all([attachment, binding])
    sqlite_session.commit()
    attachment_id = attachment.id
    binding_id = binding.id
    phase_events: list[str] = []
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")
    disable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))

    with (
        _record_transaction_events(sqlite_session_factory, phase_events),
        patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.disable_summaries_for_segments",
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
    assert processor.clean.call_args.args[1] == ["node-1"]
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None


def test_late_disable_delivery_skips_segment_restored_after_publish_failure(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
) -> None:
    dataset, document, segment = indexed_segment
    processor = _CleanProbe()

    def unexpected_summary(**_kwargs: object) -> None:
        raise AssertionError("A stale disable must not update summaries")

    with (
        patch(
            "tasks.disable_segments_from_index_task.IndexProcessorFactory",
            new=lambda _doc_form: _IndexProcessorFactoryStub(processor),
        ),
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.disable_summaries_for_segments",
            new=unexpected_summary,
        ),
    ):
        _disable_segments_from_index([segment.id], dataset.id, document.id, lease=_OwnedLease())

    assert processor.called is False


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


@pytest.mark.parametrize("document_state", ["disabled", "archived"])
def test_delete_segment_cleanup_uses_explicit_nodes_after_document_state_changes(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
    document_state: str,
) -> None:
    dataset, document, segment = indexed_segment
    if document_state == "disabled":
        document.enabled = False
    else:
        document.archived = True
    sqlite_session.commit()
    processor = _CleanProbe()

    with patch(
        "tasks.delete_segment_from_index_task.IndexProcessorFactory",
        new=lambda _doc_form: _IndexProcessorFactoryStub(processor),
    ):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    assert processor.called is True


def test_delete_segment_cleanup_uses_bounded_late_ack_retry_policy() -> None:
    assert getattr(delete_segment_from_index_task, "autoretry_for", ()) == (Exception,)
    assert delete_segment_from_index_task.max_retries == 5
    assert getattr(delete_segment_from_index_task, "retry_backoff", False) is True
    assert delete_segment_from_index_task.acks_late is True
    assert delete_segment_from_index_task.reject_on_worker_lost is True


def test_delete_segment_cleans_document_scoped_summary_after_owner_row_is_gone(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    foreign_document = Document(
        id=str(uuid.uuid4()),
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=2,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-2",
        name="foreign.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=segment.created_by,
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    foreign_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=foreign_document.id,
        position=1,
        content="foreign content",
        word_count=2,
        tokens=2,
        created_by=segment.created_by,
        index_node_id="foreign-node",
        index_node_hash="foreign-hash",
        status=SegmentStatus.COMPLETED,
    )
    target_summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content="target summary",
        summary_index_node_id="target-summary-node",
        status=SummaryStatus.COMPLETED,
    )
    foreign_summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=foreign_document.id,
        chunk_id=foreign_segment.id,
        summary_content="foreign summary",
        summary_index_node_id="foreign-summary-node",
        status=SummaryStatus.COMPLETED,
    )
    sqlite_session.add_all([dataset, foreign_document, foreign_segment, target_summary, foreign_summary])
    sqlite_session.commit()
    dataset_id = dataset.id
    target_segment_id = segment.id
    target_summary_id = target_summary.id
    foreign_summary_id = foreign_summary.id
    sqlite_session.delete(segment)
    sqlite_session.commit()

    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
        patch("services.knowledge.summaries.adapters._delete_summary_vectors") as delete_summary_vectors,
    ):
        delete_segment_from_index_task.run(
            ["node-1"],
            dataset_id,
            document.id,
            [target_segment_id, foreign_segment.id],
        )

    processor = processor_factory.return_value.init_index_processor.return_value
    assert processor.clean.call_args.kwargs["delete_summaries"] is False
    delete_summary_vectors.assert_called_once()
    assert delete_summary_vectors.call_args.args[1] == ["target-summary-node"]
    sqlite_session.expire_all()
    assert sqlite_session.get(DocumentSegmentSummary, target_summary_id) is None
    assert sqlite_session.get(DocumentSegmentSummary, foreign_summary_id) is not None


@pytest.mark.parametrize("is_multimodal", [False, True])
def test_delete_segment_reclaims_unreferenced_attachment(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
    is_multimodal: bool,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = is_multimodal
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
    binding_id = binding.id

    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.delete_segment_from_index_task.delete_upload_blob") as delete_blob,
    ):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    processor = processor_factory.return_value.init_index_processor.return_value
    assert processor.clean.call_count == 1
    assert processor.clean.call_args.args[1] == ["node-1"]
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None
    delete_blob.assert_called_once_with("attachments/segment-image.png")


def test_delete_segment_preserves_attachment_shared_by_another_segment(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    other_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=2,
        content="other content",
        word_count=1,
        tokens=1,
        created_by=segment.created_by,
        index_node_id="node-2",
        index_node_hash="hash-2",
        disabled_by=segment.disabled_by,
        status=SegmentStatus.COMPLETED,
    )
    attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/shared-segment-image.png",
        name="shared-segment-image.png",
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
    shared_binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=other_segment.id,
        attachment_id=attachment.id,
    )
    sqlite_session.add_all([dataset, other_segment, attachment, binding, shared_binding])
    sqlite_session.commit()
    attachment_id = attachment.id
    binding_id = binding.id
    shared_binding_id = shared_binding.id

    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.delete_segment_from_index_task.delete_upload_blob") as delete_blob,
    ):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    processor = processor_factory.return_value.init_index_processor.return_value
    assert processor.clean.call_count == 1
    assert processor.clean.call_args.args[1] == ["node-1"]
    assert processor.clean.call_args.kwargs["with_keywords"] is True
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(SegmentAttachmentBinding, shared_binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None
    persisted_document = sqlite_session.get_one(Document, document.id)
    assert pending_upload_cleanup_ids(persisted_document.data_source_info_dict) == (attachment_id,)
    delete_blob.assert_not_called()


def test_delete_segment_fast_worker_retains_candidate_until_segment_row_is_deleted(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, segment = indexed_segment
    attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/segment-content-image.png",
        name="segment-content-image.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=segment.created_by,
        created_at=datetime.now(UTC),
        used=True,
    )
    sqlite_session.add(attachment)
    sqlite_session.flush()
    segment.content = f"![image](/files/{attachment.id}/image-preview)"
    binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        attachment_id=attachment.id,
    )
    sqlite_session.add(binding)
    sqlite_session.commit()
    attachment_id = attachment.id

    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory"),
        patch("tasks.delete_segment_from_index_task.delete_upload_blob") as delete_blob,
    ):
        # Simulate an already-published legacy message winning the race with
        # the application transaction that removes the target segment row.
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

        sqlite_session.expire_all()
        assert sqlite_session.get(UploadFile, attachment_id) is not None
        persisted_document = sqlite_session.get_one(Document, document.id)
        assert pending_upload_cleanup_ids(persisted_document.data_source_info_dict) == (attachment_id,)
        delete_blob.assert_not_called()

        persisted_segment = sqlite_session.get_one(DocumentSegment, segment.id)
        sqlite_session.delete(persisted_segment)
        sqlite_session.commit()

        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, attachment_id) is None
    persisted_document = sqlite_session.get_one(Document, document.id)
    assert pending_upload_cleanup_ids(persisted_document.data_source_info_dict) == ()
    delete_blob.assert_called_once_with("attachments/segment-content-image.png")


def test_delete_segment_storage_failure_leaves_safe_orphan_after_metadata_commit(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dataset, document, segment = indexed_segment
    attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/retry-segment-image.png",
        name="retry-segment-image.png",
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
    sqlite_session.add_all([attachment, binding])
    sqlite_session.commit()
    attachment_id = attachment.id
    binding_id = binding.id

    caplog.set_level(logging.ERROR, logger="repositories.file.upload_file_reclamation")
    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory"),
        patch(
            "tasks.delete_segment_from_index_task.delete_upload_blob",
            side_effect=RuntimeError("storage unavailable"),
        ) as delete_blob,
    ):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None
    persisted_document = sqlite_session.get_one(Document, document.id)
    assert pending_upload_cleanup_ids(persisted_document.data_source_info_dict) == ()
    delete_blob.assert_called_once_with("attachments/retry-segment-image.png")
    assert attachment_id in caplog.text
    assert "attachments/retry-segment-image.png" in caplog.text


def test_delete_segment_retries_durable_attachment_cleanup_after_owner_contention(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dataset, document, segment = indexed_segment
    attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/retry-contention-image.png",
        name="retry-contention-image.png",
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
    sqlite_session.add_all([attachment, binding])
    sqlite_session.commit()
    attachment_id = attachment.id
    binding_id = binding.id

    reference_error = OperationalError("SELECT owner", {}, LockNotAvailable("could not obtain owner lock"))

    def raise_owner_contention(
        _session: Session,
        *,
        tenant_id: str,
        candidates: Sequence[UploadFileReferenceCandidate],
    ) -> set[str]:
        assert tenant_id == dataset.tenant_id
        assert tuple(candidate.id for candidate in candidates) == (attachment_id,)
        raise reference_error

    caplog.set_level(logging.ERROR, logger="tasks.delete_segment_from_index_task")
    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory"),
        patch("services.file_adapters.UPLOAD_FILE_REFERENCE_QUERIES", new=(raise_owner_contention,)),
    ):
        with pytest.raises(OperationalError, match="could not obtain owner lock"):
            delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    assert dataset.tenant_id in caplog.text
    assert dataset.id in caplog.text
    assert document.id in caplog.text
    assert segment.id in caplog.text

    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    persisted_attachment = sqlite_session.get_one(UploadFile, attachment_id)
    assert persisted_attachment.key == "attachments/retry-contention-image.png"
    persisted_document = sqlite_session.get_one(Document, document.id)
    assert pending_upload_cleanup_ids(persisted_document.data_source_info_dict) == (attachment_id,)

    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory"),
        patch("tasks.delete_segment_from_index_task.delete_upload_blob") as delete_blob,
    ):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, attachment_id) is None
    persisted_document = sqlite_session.get_one(Document, document.id)
    assert pending_upload_cleanup_ids(persisted_document.data_source_info_dict) == ()
    delete_blob.assert_called_once_with("attachments/retry-contention-image.png")


def test_delete_segment_rejects_document_outside_dataset_owner_chain(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, segment = indexed_segment
    document.dataset_id = str(uuid.uuid4())
    sqlite_session.commit()

    with patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory:
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    processor_factory.assert_not_called()
