import uuid
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import Retry
from google.api_core.exceptions import NotFound
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.google_cloud_storage import GoogleCloudStorage
from extensions.storage.storage_type import StorageType
from models.dataset import (
    ChildChunk,
    Dataset,
    Document,
    DocumentSegment,
    DocumentSegmentSummary,
    SegmentAttachmentBinding,
)
from models.enums import (
    CreatorUserRole,
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    SegmentStatus,
    SummaryStatus,
)
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


class _VectorBackend:
    def __init__(self) -> None:
        self.deleted_ids: list[list[str]] = []
        self.delete_called = False

    def delete_by_ids(self, ids: list[str]) -> None:
        self.deleted_ids.append(ids)

    def delete(self) -> None:
        self.delete_called = True


class _VectorFactory:
    def __init__(self, backend: _VectorBackend) -> None:
        self._backend = backend

    def init_vector(self, *_args, **_kwargs):
        return self._backend


class _DeleteBlobSequence:
    def __init__(self, outcomes: list[BaseException | None]) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[str] = []

    def __call__(self, key: str) -> None:
        self.calls.append(key)
        outcome = self.outcomes.pop(0)
        if outcome is not None:
            raise outcome


class _StorageBucket:
    def __init__(self, delete_blob: _DeleteBlobSequence) -> None:
        self._delete_blob = delete_blob

    def delete_blob(self, key: str) -> None:
        self._delete_blob(key)


class _StorageClient:
    def __init__(self, bucket: _StorageBucket) -> None:
        self._bucket = bucket

    def get_bucket(self, _name: str) -> _StorageBucket:
        return self._bucket


def _google_storage(delete_blob: _DeleteBlobSequence) -> GoogleCloudStorage:
    bucket = _StorageBucket(delete_blob)
    with patch(
        "extensions.storage.google_cloud_storage.google_cloud_storage.Client",
        return_value=_StorageClient(bucket),
    ):
        storage = GoogleCloudStorage()
    storage.bucket_name = "test-bucket"
    return storage


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


def test_delete_disabled_segment_with_no_index_node_ids_preserves_other_segments(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, disabled_segment = indexed_segment
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    dataset.index_struct = '{"type":"pgvector"}'
    dataset.is_multimodal = True
    document.doc_form = IndexStructureType.PARENT_CHILD_INDEX
    disabled_segment.enabled = False
    disabled_segment.index_node_id = None
    live_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=2,
        content="live content",
        word_count=2,
        tokens=2,
        created_by=disabled_segment.created_by,
        index_node_id="live-node",
        index_node_hash="live-hash",
        status=SegmentStatus.COMPLETED,
    )
    disabled_summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=disabled_segment.id,
        summary_content="disabled summary",
        summary_index_node_id="disabled-summary-node",
        status=SummaryStatus.COMPLETED,
    )
    live_summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=live_segment.id,
        summary_content="live summary",
        summary_index_node_id="live-summary-node",
        status=SummaryStatus.COMPLETED,
    )
    disabled_child = ChildChunk(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=disabled_segment.id,
        position=1,
        content="disabled child",
        word_count=2,
        created_by=disabled_segment.created_by,
        index_node_id="disabled-child-node",
    )
    live_child = ChildChunk(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=live_segment.id,
        position=1,
        content="live child",
        word_count=2,
        created_by=live_segment.created_by,
        index_node_id="live-child-node",
    )
    attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/disabled-segment-image.png",
        name="disabled-segment-image.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=disabled_segment.created_by,
        created_at=datetime.now(UTC),
        used=True,
    )
    binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=disabled_segment.id,
        attachment_id=attachment.id,
    )
    sqlite_session.add_all(
        [
            dataset,
            live_segment,
            disabled_summary,
            live_summary,
            disabled_child,
            live_child,
            attachment,
            binding,
        ]
    )
    sqlite_session.commit()
    live_segment_id = live_segment.id
    live_child_id = live_child.id
    disabled_child_id = disabled_child.id
    disabled_summary_id = disabled_summary.id
    live_summary_id = live_summary.id
    attachment_id = attachment.id
    binding_id = binding.id

    vector_backend = _VectorBackend()
    vector_factory_instance = _VectorFactory(vector_backend)
    with (
        patch(
            "core.rag.datasource.vdb.vector_factory.Vector.get_vector_factory",
            return_value=lambda: vector_factory_instance,
        ),
        patch("core.rag.datasource.keyword.keyword_factory.Keyword.delete") as keyword_delete,
        patch("tasks.delete_segment_from_index_task.storage.delete") as storage_delete,
    ):
        delete_segment_from_index_task.run([], dataset.id, document.id, [disabled_segment.id], [])

    assert vector_backend.deleted_ids == [["disabled-summary-node"]]
    assert vector_backend.delete_called is False
    keyword_delete.assert_not_called()
    storage_delete.assert_called_once_with(attachment.key)
    sqlite_session.expire_all()
    assert sqlite_session.get(DocumentSegment, live_segment_id) is not None
    assert sqlite_session.get(DocumentSegmentSummary, live_summary_id) is not None
    assert sqlite_session.get(ChildChunk, live_child_id) is not None
    assert sqlite_session.get(DocumentSegmentSummary, disabled_summary_id) is None
    assert sqlite_session.get(ChildChunk, disabled_child_id) is None
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None


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
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory"),
        patch("tasks.delete_segment_from_index_task.storage.delete") as storage_delete,
    ):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    storage_delete.assert_called_once_with(attachment_key)
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None


@pytest.mark.parametrize(
    ("document_state", "value"),
    [("enabled", False), ("archived", True), ("indexing_status", IndexingStatus.PARSING)],
)
def test_delete_segment_cleans_attachments_when_document_cannot_be_indexed(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
    document_state: str,
    value: object,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    setattr(document, document_state, value)
    attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/disabled-document-image.png",
        name="disabled-document-image.png",
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
    sqlite_session.add_all([dataset, document, attachment, binding])
    sqlite_session.commit()
    attachment_id = attachment.id
    attachment_key = attachment.key
    binding_id = binding.id

    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.delete_segment_from_index_task.storage.delete") as storage_delete,
    ):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    processor = processor_factory.return_value.init_index_processor.return_value
    processor.clean.assert_called_once()
    assert processor.clean.call_args.kwargs["node_ids"] == [attachment_id]
    assert processor.clean.call_args.kwargs["with_keywords"] is False
    storage_delete.assert_called_once_with(attachment_key)
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None


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
        patch("tasks.delete_segment_from_index_task.storage.delete") as storage_delete,
    ):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    processor = processor_factory.return_value.init_index_processor.return_value
    assert processor.clean.call_count == 1
    assert processor.clean.call_args.args[1] == ["node-1"]
    assert processor.clean.call_args.kwargs["with_keywords"] is True
    storage_delete.assert_not_called()
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(SegmentAttachmentBinding, shared_binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None


def test_delete_segment_retries_attachment_storage_delete_before_database_cleanup(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
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
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory"),
        patch(
            "tasks.delete_segment_from_index_task.storage.delete",
            side_effect=[RuntimeError("storage unavailable"), None],
        ) as storage_delete,
        patch.object(delete_segment_from_index_task, "retry", side_effect=Retry()) as retry_task,
    ):
        with pytest.raises(Retry):
            delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])
        retry_task.assert_called_once()
        storage_delete.assert_called_once_with(attachment_key)
        sqlite_session.expire_all()
        assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is not None
        assert sqlite_session.get(UploadFile, attachment_id) is not None
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

        assert storage_delete.call_count == 2
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None


def test_delete_segment_retry_tolerates_google_missing_object_after_partial_success(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    attachments = [
        UploadFile(
            tenant_id=dataset.tenant_id,
            storage_type=StorageType.GOOGLE_STORAGE,
            key=f"attachments/retry-{index}.png",
            name=f"retry-{index}.png",
            size=10,
            extension="png",
            mime_type="image/png",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=segment.created_by,
            created_at=datetime.now(UTC),
            used=True,
        )
        for index in range(2)
    ]
    bindings = [
        SegmentAttachmentBinding(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            segment_id=segment.id,
            attachment_id=attachment.id,
        )
        for attachment in attachments
    ]
    sqlite_session.add_all([dataset, *attachments, *bindings])
    sqlite_session.commit()
    attachment_ids = [attachment.id for attachment in attachments]
    attachment_keys = [attachment.key for attachment in attachments]
    binding_ids = [binding.id for binding in bindings]

    delete_blob = _DeleteBlobSequence([None, RuntimeError("temporary failure"), NotFound("missing"), None])
    google_storage = _google_storage(delete_blob)

    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory"),
        patch(
            "tasks.delete_segment_from_index_task.storage.delete",
            side_effect=google_storage.delete,
        ) as storage_delete,
        patch.object(delete_segment_from_index_task, "retry", side_effect=Retry()) as retry_task,
    ):
        with pytest.raises(Retry):
            delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])
        retry_task.assert_called_once()
        assert storage_delete.call_count == 2
        sqlite_session.expire_all()
        assert all(sqlite_session.get(SegmentAttachmentBinding, item) is not None for item in binding_ids)
        assert all(sqlite_session.get(UploadFile, item) is not None for item in attachment_ids)

        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    assert storage_delete.call_count == 4
    deleted_keys = delete_blob.calls
    assert deleted_keys[:2] == deleted_keys[2:]
    assert set(deleted_keys[:2]) == set(attachment_keys)
    sqlite_session.expire_all()
    assert all(sqlite_session.get(SegmentAttachmentBinding, item) is None for item in binding_ids)
    assert all(sqlite_session.get(UploadFile, item) is None for item in attachment_ids)


def test_delete_segment_treats_google_missing_object_on_first_attempt_as_success(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.GOOGLE_STORAGE,
        key="attachments/already-absent.png",
        name="already-absent.png",
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

    delete_blob = _DeleteBlobSequence([NotFound("missing")])
    google_storage = _google_storage(delete_blob)
    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory"),
        patch(
            "tasks.delete_segment_from_index_task.storage.delete",
            side_effect=google_storage.delete,
        ) as storage_delete,
        patch.object(delete_segment_from_index_task, "retry") as retry_task,
    ):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    storage_delete.assert_called_once_with(attachment.key)
    retry_task.assert_not_called()
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None


def test_delete_segment_keeps_attachment_references_after_retries_are_exhausted(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    attachment = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/exhausted-retry.png",
        name="exhausted-retry.png",
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
    terminal_error = RuntimeError("retries exhausted")

    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory"),
        patch(
            "tasks.delete_segment_from_index_task.storage.delete",
            side_effect=RuntimeError("storage unavailable"),
        ),
        patch.object(
            delete_segment_from_index_task,
            "retry",
            side_effect=[Retry(), Retry(), Retry(), terminal_error],
        ) as retry_task,
    ):
        for _ in range(4):
            with pytest.raises((Retry, RuntimeError)):
                delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    assert retry_task.call_count == 4
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None
