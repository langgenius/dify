import uuid
from collections.abc import Generator
from contextlib import contextmanager, nullcontext
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import KnowledgeUploadFileReference, UploadFile
from repositories.knowledge.upload_file_repository import replace_segment_image_upload_file_references
from services.knowledge.indexing.cleanup import DocumentCleanupManifest, SegmentAttachmentCleanup, UploadFileCleanup
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind
from tasks.delete_segment_from_index_task import _delete_segments, delete_segment_from_index_task
from tasks.disable_segment_from_index_task import disable_segment_from_index_task
from tasks.disable_segments_from_index_task import disable_segments_from_index_task
from tests.unit_tests.config_override import apply_config_overrides


class LeaseStub:
    token = "lease-token"
    recovered_execution = False

    def assert_owned(self) -> None:
        pass


class LockStub:
    def hold(self, *_args: object, **_kwargs: object) -> nullcontext[LeaseStub]:
        return nullcontext(LeaseStub())


@pytest.fixture(autouse=True)
def _stub_cleanup_dispatcher(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.knowledge.task_outbox.gateway.wake_knowledge_task_dispatcher", lambda: True)
    apply_config_overrides(monkeypatch, ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=True)


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
        enabled=False,
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
    sqlite_session: Session,
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment = indexed_segment
    generation = "2b31ff86-bc59-4a07-8d9c-5fb40ba34269"
    segment.status = SegmentStatus.INDEXING
    segment.indexing_at = datetime(2026, 10, 19, 12, 0, 0)
    segment.indexing_generation = generation
    sqlite_session.commit()
    phase_events: list[str] = []
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")
    disable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))
    monkeypatch.setattr(
        "tasks.disable_segments_from_index_task.knowledge_task_execution",
        lambda _intent_id: nullcontext(LeaseStub()),
    )

    with (
        _record_transaction_events(sqlite_session_factory, phase_events),
        patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.knowledge.summaries.adapters.SummaryIndexAdapter.disable_summaries_for_segments",
            disable_summaries,
        ),
        patch("tasks.disable_segments_from_index_task._indexing_lock", return_value=LockStub()),
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        disable_segments_from_index_task.run([segment.id], dataset.id, document.id, "intent-1", False, generation)

    assert phase_events == ["clean", "summary", "commit"]
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

    with _record_transaction_events(sqlite_session_factory, phase_events):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    assert phase_events == ["commit", "commit"]
    with sqlite_session_factory() as session:
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP)
        )
        assert intent is not None
        assert intent.payload["vector_node_ids"] == ["node-1"]


def test_delete_segment_removes_attachment_blobs_from_storage(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
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

    with patch("tasks.clean_upload_files_task.storage.delete") as storage_delete:
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    storage_delete.assert_called_once_with(attachment_key)
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None
    index_cleanup = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP)
    )
    assert index_cleanup is not None
    vector_node_ids = index_cleanup.payload["vector_node_ids"]
    assert isinstance(vector_node_ids, list)
    assert attachment_id in vector_node_ids
    assert index_cleanup.payload["attachment_node_ids"] == [attachment_id]


def test_delete_segment_preserves_attachment_shared_by_another_segment(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
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

    with patch("tasks.clean_upload_files_task.storage.delete") as storage_delete:
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    storage_delete.assert_not_called()
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(SegmentAttachmentBinding, shared_binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None
    index_cleanup = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP)
    )
    assert index_cleanup is not None
    vector_node_ids = index_cleanup.payload["vector_node_ids"]
    assert isinstance(vector_node_ids, list)
    assert attachment_id not in vector_node_ids
    assert index_cleanup.payload["attachment_node_ids"] == []


def test_delete_segment_retries_persisted_attachment_after_storage_failure(
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

    manifest = DocumentCleanupManifest(
        segment_attachments=(
            SegmentAttachmentCleanup(
                binding_id=binding_id,
                attachment_id=attachment_id,
                key=attachment_key,
            ),
        )
    ).to_payload()

    with (
        patch(
            "tasks.clean_upload_files_task.storage.delete",
            side_effect=RuntimeError("storage unavailable"),
        ) as storage_delete,
        pytest.raises(RuntimeError, match="storage unavailable"),
    ):
        _delete_segments(
            index_node_ids=["node-1"],
            dataset_id=dataset.id,
            document_id=document.id,
            segment_ids=[segment.id],
            child_node_ids=[],
            tenant_id=dataset.tenant_id,
            cleanup_manifest=manifest,
            durable=True,
        )

    storage_delete.assert_called_once_with(attachment_key)
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    pending_upload = sqlite_session.get(UploadFile, attachment_id)
    assert pending_upload is not None
    assert pending_upload.knowledge_cleanup_started_at is not None

    with patch("tasks.clean_upload_files_task.storage.delete") as storage_delete:
        _delete_segments(
            index_node_ids=["node-1"],
            dataset_id=dataset.id,
            document_id=document.id,
            segment_ids=[segment.id],
            child_node_ids=[],
            tenant_id=dataset.tenant_id,
            cleanup_manifest=manifest,
            durable=True,
        )

    storage_delete.assert_called_once_with(attachment_key)
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, attachment_id) is None


def test_delete_segment_cleans_persisted_inline_image_after_segment_row_is_gone(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    image = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="images/inline.png",
        name="inline.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=segment.created_by,
        created_at=datetime.now(UTC),
        used=True,
    )
    sqlite_session.add_all([dataset, image])
    sqlite_session.delete(segment)
    sqlite_session.commit()
    manifest = DocumentCleanupManifest(image_files=(UploadFileCleanup(id=image.id, key=image.key),)).to_payload()
    image_id = image.id
    image_key = image.key

    with patch("tasks.clean_upload_files_task.storage.delete") as storage_delete:
        _delete_segments(
            index_node_ids=["node-1"],
            dataset_id=dataset.id,
            document_id=document.id,
            segment_ids=[segment.id],
            child_node_ids=[],
            tenant_id=dataset.tenant_id,
            cleanup_manifest=manifest,
            durable=True,
        )

    storage_delete.assert_called_once_with(image_key)
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, image_id) is None
    cleanup_intent = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP)
    )
    assert cleanup_intent is not None
    assert cleanup_intent.payload["inline_image_node_ids"] == [image_id]


def test_delete_segment_preserves_inline_image_vector_shared_by_another_segment(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
) -> None:
    dataset, document, segment = indexed_segment
    dataset.is_multimodal = True
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    dataset.index_struct = '{"type":"pgvector"}'
    document.indexing_status = IndexingStatus.COMPLETED
    segment.enabled = True
    segment.status = SegmentStatus.COMPLETED
    survivor = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=2,
        content="survivor",
        word_count=1,
        tokens=1,
        created_by=segment.created_by,
        index_node_id="node-2",
        enabled=True,
        status=SegmentStatus.COMPLETED,
    )
    image = UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key="images/shared-inline.png",
        name="shared-inline.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=segment.created_by,
        created_at=datetime.now(UTC),
        used=True,
    )
    sqlite_session.add_all([dataset, survivor, image])
    sqlite_session.flush()
    markdown = f"![image](/files/{image.id}/image-preview)"
    segment.content = markdown
    survivor.content = markdown
    for current_segment in (segment, survivor):
        replace_segment_image_upload_file_references(
            sqlite_session,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            segment_id=current_segment.id,
            content=current_segment.content,
        )
    sqlite_session.commit()
    manifest = DocumentCleanupManifest(image_files=(UploadFileCleanup(id=image.id, key=image.key),)).to_payload()
    image_id = image.id
    target_segment_id = segment.id
    sqlite_session.delete(segment)
    sqlite_session.commit()

    _delete_segments(
        index_node_ids=["node-1"],
        dataset_id=dataset.id,
        document_id=document.id,
        segment_ids=[target_segment_id],
        child_node_ids=[],
        summary_node_ids=["deleted-summary-node"],
        tenant_id=dataset.tenant_id,
        cleanup_manifest=manifest,
        durable=True,
    )

    sqlite_session.expire_all()
    assert sqlite_session.get(DocumentSegment, survivor.id) is not None
    assert sqlite_session.get(UploadFile, image_id) is not None
    assert (
        sqlite_session.scalar(
            select(KnowledgeUploadFileReference).where(
                KnowledgeUploadFileReference.resource_id == survivor.id,
                KnowledgeUploadFileReference.upload_file_id == image_id,
            )
        )
        is not None
    )
    cleanup_intent = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP)
    )
    assert cleanup_intent is not None
    vector_node_ids = cleanup_intent.payload["vector_node_ids"]
    assert isinstance(vector_node_ids, list)
    assert image_id not in vector_node_ids
    assert "deleted-summary-node" in vector_node_ids
    assert cleanup_intent.payload["inline_image_node_ids"] == []
