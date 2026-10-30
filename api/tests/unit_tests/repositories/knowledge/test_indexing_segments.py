import json
from collections.abc import Callable, Sequence
from contextlib import nullcontext
from dataclasses import replace
from datetime import UTC, datetime

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import AttachmentDocument, ChildDocument
from core.rag.models.document import Document as IndexDocument
from enums.creator import CreatorUserRole
from extensions.storage.storage_type import StorageType
from graphon.file import FileTransferMethod, FileType
from models import MessageFile
from models.dataset import ChildChunk, Dataset, DatasetProcessRule, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import IndexingStatus, ProcessRuleMode, SegmentStatus
from models.model import UploadFile
from repositories.file.upload_file_repository import UploadFileRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.errors.file import UploadFileReferenceNotFoundError
from services.file_adapters import build_upload_file_reclaimer
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.contracts import IndexingDocument
from services.knowledge.indexing.errors import DocumentIsDeletedPausedError
from services.knowledge.segments import indexing as segment_indexing
from tests.unit_tests.repositories.knowledge.test_document_repository import _dataset, _document

IndexingRows = tuple[SQLAlchemySegmentRepository, IndexingDocument, list[IndexDocument]]


class _IndexRedisStub:
    def get(self, name: str | bytes) -> None:
        del name

    def set(self, name: str | bytes, value: object, *, nx: bool = False, ex: int | None = None) -> bool:
        del name, value, nx, ex
        return True

    def setex(self, name: str, time: int, value: object) -> bool:
        del name, time, value
        return True

    def lock(self, name: str, timeout: int) -> nullcontext[None]:
        del name, timeout
        return nullcontext()


class _VectorProbe:
    def __init__(self) -> None:
        self.multimodal_writes: list[tuple[str, ...]] = []

    def create_multimodal(self, documents: Sequence[IndexDocument], **_kwargs: object) -> None:
        self.multimodal_writes.append(tuple(document.metadata["doc_id"] for document in documents))


def _upload_file(*, key: str) -> UploadFile:
    return UploadFile(
        tenant_id="workspace-1",
        storage_type=StorageType.LOCAL,
        key=key,
        name=f"{key}.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime(2026, 10, 29, tzinfo=UTC),
        used=False,
    )


def _reclaim_candidates(
    session_factory: sessionmaker[Session], *, file_ids: list[str], delete_blob: Callable[[str], None]
) -> tuple[str, ...]:
    files = UploadFileRepository(session_factory=session_factory)
    return build_upload_file_reclaimer(session_factory=session_factory, files=files).delete_unreferenced_files(
        tenant_id="workspace-1",
        file_ids=file_ids,
        delete_blob=delete_blob,
    )


def _cleanup_file_ids(session_factory: sessionmaker[Session]) -> list[str]:
    with session_factory() as session:
        document = session.get_one(Document, "document-1")
        file_ids = document.data_source_info_dict["_pending_upload_cleanup_ids"]
        assert isinstance(file_ids, list)
        assert all(isinstance(file_id, str) for file_id in file_ids)
        return file_ids


@pytest.fixture
def indexing_rows(sqlite_session_factory: sessionmaker[Session]) -> IndexingRows:
    with sqlite_session_factory.begin() as session:
        document = _document("document-1", status=IndexingStatus.SPLITTING)
        document.doc_form = IndexStructureType.PARENT_CHILD_INDEX
        rule = DatasetProcessRule(
            dataset_id="dataset-1",
            mode=ProcessRuleMode.HIERARCHICAL,
            rules='{"parent_mode": "paragraph"}',
            created_by="account-1",
        )
        rule.id = "rule-1"
        document.dataset_process_rule_id = rule.id
        session.add_all([_dataset("dataset-1", "workspace-1"), document, _document("document-2"), rule])
    documents = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    segments = SQLAlchemySegmentRepository(session_factory=sqlite_session_factory)
    job = documents.get_indexing_document(DatasetRef("workspace-1", "dataset-1").document("document-1"))
    chunks = [
        IndexDocument(
            page_content=f"parent-{i}",
            metadata={"doc_id": f"node-{i}", "doc_hash": f"hash-{i}"},
            children=[ChildDocument(page_content="child", metadata={"doc_id": f"child-{i}", "doc_hash": "child-hash"})],
        )
        for i in range(2)
    ]
    return segments, job, chunks


def test_saved_segments_are_visible_before_workers_and_resume_preserves_total(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    attachment = _upload_file(key="resumed-attachment")
    chunks[1].attachments = [
        AttachmentDocument(page_content=attachment.name, metadata={"doc_id": attachment.id, "doc_type": "image"})
    ]
    with sqlite_session_factory.begin() as session:
        session.add(attachment)
    segments.save_for_indexing(job, chunks, [13, 17])
    segments.complete_indexing_segments(job.ref, ["node-0"])
    resumed, tokens = segments.resume_indexing(job)
    assert tokens == 30
    assert [chunk.page_content for chunk in resumed] == ["parent-1"]
    assert resumed[0].children is not None
    assert resumed[0].children[0].page_content == "child"
    assert resumed[0].attachments is not None
    assert [image.metadata["doc_id"] for image in resumed[0].attachments] == [attachment.id]
    assert resumed[0].attachments[0].metadata["dataset_id"] == job.ref.dataset.dataset_id
    assert resumed[0].attachments[0].metadata["document_id"] == job.ref.document_id
    with sqlite_session_factory() as session:
        persisted_document = session.get(Document, "document-1")
        assert persisted_document is not None
        assert persisted_document.indexing_status == IndexingStatus.INDEXING
        rows = session.scalars(select(DocumentSegment).order_by(DocumentSegment.position)).all()
        assert [row.status for row in rows] == [SegmentStatus.COMPLETED, SegmentStatus.INDEXING]
    replacement = [chunks[0]]
    segments.save_for_indexing(job, replacement, [19])
    with sqlite_session_factory() as session:
        assert len(session.scalars(select(DocumentSegment)).all()) == 1
        assert len(session.scalars(select(ChildChunk)).all()) == 1


def test_repeated_save_does_not_duplicate_segments_or_children(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    segments.save_for_indexing(job, chunks, [13, 17])
    segments.save_for_indexing(job, chunks, [19, 23])
    with sqlite_session_factory() as session:
        assert len(session.scalars(select(ChildChunk)).all()) == 2
    assert segments.resume_indexing(job)[1] == 42


def test_save_for_indexing_validates_content_files_before_replacing_rows(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    segments.save_for_indexing(job, chunks, [13, 17])
    missing_id = "missing-upload"
    replacement = [
        IndexDocument(
            page_content=f"![image](/files/{missing_id}/file-preview)",
            metadata={"doc_id": "replacement", "doc_hash": "replacement-hash"},
        )
    ]

    with pytest.raises(UploadFileReferenceNotFoundError):
        segments.save_for_indexing(job, replacement, [19])

    with sqlite_session_factory() as session:
        rows = session.scalars(select(DocumentSegment).order_by(DocumentSegment.position)).all()
        assert [row.index_node_id for row in rows] == ["node-0", "node-1"]


def test_segment_content_guard_checks_only_new_file_references(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    segments.save_for_indexing(job, chunks, [13, 17])
    segments.complete_indexing_segments(job.ref, ["node-0", "node-1"])
    SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).complete_indexing(
        job.ref, tokens=30, latency=0
    )
    with sqlite_session_factory.begin() as session:
        segment = session.scalars(select(DocumentSegment).order_by(DocumentSegment.position)).first()
        assert segment is not None
        ref = job.ref.segment(segment.id)
        segment.content = "![historical](/files/missing-historical/file-preview)"

    segments.save_segment(ref, {"enabled": False})
    with pytest.raises(UploadFileReferenceNotFoundError):
        segments.save_segment(ref, {"content": "![new](/files/missing-new/file-preview)"})

    with sqlite_session_factory() as session:
        segment = session.get_one(DocumentSegment, ref.segment_id)
        assert segment.enabled is False
        assert segment.content == "![historical](/files/missing-historical/file-preview)"


def test_child_content_guard_checks_only_new_file_references(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    segments.save_for_indexing(job, chunks, [13, 17])
    segments.complete_indexing_segments(job.ref, ["node-0", "node-1"])
    SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory).complete_indexing(
        job.ref, tokens=30, latency=0
    )
    with sqlite_session_factory.begin() as session:
        segment = session.scalars(select(DocumentSegment).order_by(DocumentSegment.position)).first()
        assert segment is not None
        ref = job.ref.segment(segment.id)
        child = session.scalar(select(ChildChunk).where(ChildChunk.segment_id == segment.id))
        assert child is not None
        child.content = "![historical](/files/missing-historical/file-preview)"

    existing = segments.get_children(ref)
    assert existing is not None
    unchanged = existing[0]
    segments.save_children(ref, updated=(unchanged,))
    changed = replace(
        unchanged,
        data=unchanged.data.model_copy(update={"content": "![new](/files/missing-new/file-preview)"}),
    )
    with pytest.raises(UploadFileReferenceNotFoundError):
        segments.save_children(ref, updated=(changed,))

    with sqlite_session_factory() as session:
        child = session.get_one(ChildChunk, unchanged.data.id)
        assert child.content == "![historical](/files/missing-historical/file-preview)"


def test_token_count_mismatch_rolls_back_segments_and_state(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    with pytest.raises(ValueError, match="zip\\(\\) argument 2 is shorter than argument 1"):
        segments.save_for_indexing(job, chunks, [13])
    with sqlite_session_factory() as session:
        assert session.scalars(select(DocumentSegment)).all() == []
        persisted_document = session.get(Document, "document-1")
        assert persisted_document is not None
        assert persisted_document.indexing_status == IndexingStatus.SPLITTING


def test_node_id_collision_cannot_overwrite_another_document(indexing_rows: IndexingRows) -> None:
    segments, job, chunks = indexing_rows
    other = replace(job, source=job.source._replace(document_ref=job.ref.dataset.document("document-2")))
    segments.save_for_indexing(other, chunks, [3, 5])
    segments.save_for_indexing(job, chunks, [13, 17])
    segments.complete_indexing_segments(job.ref, ["node-0", "node-1"])
    segments.save_for_indexing(job, [chunks[0]], [21])
    assert segments.resume_indexing(other)[1] == 8
    assert len(segments.resume_indexing(other)[0]) == 2


def test_segment_mutations_reject_foreign_tenant(indexing_rows: IndexingRows) -> None:
    segments, job, chunks = indexing_rows
    foreign = replace(
        job, source=job.source._replace(document_ref=DatasetRef("foreign", "dataset-1").document("document-1"))
    )
    for operation in [
        lambda: segments.save_for_indexing(foreign, chunks, [13, 17]),
        lambda: segments.complete_indexing_segments(foreign.ref, ["node-0"]),
    ]:
        with pytest.raises(DocumentIsDeletedPausedError):
            operation()


@pytest.mark.parametrize("invalid_kind", ["missing", "foreign", "deleted_after_validation"])
def test_attachment_replacement_revalidates_files_before_removing_current_bindings(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows, invalid_kind: str
) -> None:
    segments, job, chunks = indexing_rows
    segments.save_for_indexing(job, chunks, [13, 17])
    original = _upload_file(key="original-attachment")
    requested = _upload_file(key="requested-attachment")
    with sqlite_session_factory.begin() as session:
        segment = session.scalars(select(DocumentSegment).order_by(DocumentSegment.position)).first()
        assert segment is not None
        ref = job.ref.segment(segment.id)
        session.add(original)
        if invalid_kind != "missing":
            if invalid_kind == "foreign":
                requested.tenant_id = "other-workspace"
            session.add(requested)
        session.add(
            SegmentAttachmentBinding(
                tenant_id=job.ref.dataset.tenant_id,
                dataset_id=job.ref.dataset.dataset_id,
                document_id=job.ref.document_id,
                segment_id=ref.segment_id,
                attachment_id=original.id,
            )
        )
    if invalid_kind == "deleted_after_validation":
        files = UploadFileRepository(session_factory=sqlite_session_factory)
        assert files.get_file(tenant_id=job.ref.dataset.tenant_id, file_id=requested.id) is not None
        with sqlite_session_factory.begin() as session:
            session.delete(session.get_one(UploadFile, requested.id))

    with pytest.raises(UploadFileReferenceNotFoundError):
        segments.replace_attachments(ref, (requested.id,))

    with sqlite_session_factory() as session:
        bindings = session.scalars(
            select(SegmentAttachmentBinding.attachment_id).where(SegmentAttachmentBinding.segment_id == ref.segment_id)
        ).all()
        assert bindings == [original.id]
        assert session.get(UploadFile, original.id) is not None


def test_attachment_gateway_does_not_publish_valid_subset_when_another_requested_file_is_missing(
    sqlite_session_factory: sessionmaker[Session],
    indexing_rows: IndexingRows,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    segments, job, chunks = indexing_rows
    segments.save_for_indexing(job, chunks, [13, 17])
    original = _upload_file(key="original-attachment")
    valid = _upload_file(key="valid-replacement")
    with sqlite_session_factory.begin() as session:
        dataset = session.get_one(Dataset, job.ref.dataset.dataset_id)
        dataset.indexing_technique = "high_quality"
        dataset.index_struct = '{"type":"qdrant"}'
        dataset.is_multimodal = True
        segment = session.scalars(select(DocumentSegment).order_by(DocumentSegment.position)).first()
        assert segment is not None
        ref = job.ref.segment(segment.id)
        session.add_all(
            [
                original,
                valid,
                SegmentAttachmentBinding(
                    tenant_id=job.ref.dataset.tenant_id,
                    dataset_id=job.ref.dataset.dataset_id,
                    document_id=job.ref.document_id,
                    segment_id=ref.segment_id,
                    attachment_id=original.id,
                ),
            ]
        )

    vector_factory_calls: list[object] = []
    vector = _VectorProbe()

    def build_vector(*args: object, **kwargs: object) -> _VectorProbe:
        vector_factory_calls.append((args, kwargs))
        return vector

    monkeypatch.setattr(segment_indexing, "Vector", build_vector)
    gateway = segment_indexing.SegmentIndexingGateway(
        segments=segments,
        uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory),
        redis=_IndexRedisStub(),
        new_session=sqlite_session_factory,
        delete_task=lambda *_args: None,
        enable_task=lambda *_args: None,
        disable_task=lambda *_args: None,
    )

    with pytest.raises(UploadFileReferenceNotFoundError):
        gateway.update_attachments(ref, (valid.id, "missing-attachment"))

    assert vector_factory_calls == []
    assert vector.multimodal_writes == []
    with sqlite_session_factory() as session:
        bindings = session.scalars(
            select(SegmentAttachmentBinding.attachment_id).where(SegmentAttachmentBinding.segment_id == ref.segment_id)
        ).all()
    assert bindings == [original.id]


def test_replacement_persists_old_file_cleanup_after_new_segments_commit(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    old_image = _upload_file(key="old-excel-image")
    old_attachment = _upload_file(key="old-attachment")
    new_image = _upload_file(key="new-excel-image")
    chunks[0].page_content = f"![old image](/files/{old_image.id}/image-preview)"
    with sqlite_session_factory.begin() as session:
        session.add_all([old_image, old_attachment, new_image])
    segments.save_for_indexing(job, chunks, [13, 17])
    with sqlite_session_factory.begin() as session:
        segment = session.scalar(select(DocumentSegment).where(DocumentSegment.document_id == job.ref.document_id))
        assert segment is not None
        session.add(
            SegmentAttachmentBinding(
                tenant_id="workspace-1",
                dataset_id="dataset-1",
                document_id=job.ref.document_id,
                segment_id=segment.id,
                attachment_id=old_attachment.id,
            )
        )

    replacement = [
        IndexDocument(
            page_content=f"![new image](/files/{new_image.id}/image-preview)",
            metadata={"doc_id": "replacement-node", "doc_hash": "replacement-hash"},
            children=[],
        )
    ]
    segments.save_for_indexing(job, replacement, [23])

    file_ids = _cleanup_file_ids(sqlite_session_factory)
    assert set(file_ids) == {old_image.id, old_attachment.id}
    deleted_keys: list[str] = []
    _reclaim_candidates(sqlite_session_factory, file_ids=file_ids, delete_blob=deleted_keys.append)
    segments.acknowledge_upload_cleanup(job, file_ids)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, old_image.id) is None
        assert session.get(UploadFile, old_attachment.id) is None
        assert session.get(UploadFile, new_image.id) is not None
        assert session.scalars(select(SegmentAttachmentBinding)).all() == []
        assert "_pending_upload_cleanup_ids" not in session.get_one(Document, job.ref.document_id).data_source_info_dict
    assert set(deleted_keys) == {old_image.key, old_attachment.key}


def test_replacement_reusing_same_file_keeps_the_published_file(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    shared_image = _upload_file(key="stable-excel-image")
    content = f"![stable image](/files/{shared_image.id}/image-preview)"
    chunks[0].page_content = content
    with sqlite_session_factory.begin() as session:
        session.add(shared_image)
    segments.save_for_indexing(job, chunks, [13, 17])

    replacement = [
        IndexDocument(
            page_content=content,
            metadata={"doc_id": "replacement-node", "doc_hash": "replacement-hash"},
            children=[],
        )
    ]
    segments.save_for_indexing(job, replacement, [19])
    file_ids = _cleanup_file_ids(sqlite_session_factory)
    deleted_keys: list[str] = []
    _reclaim_candidates(sqlite_session_factory, file_ids=file_ids, delete_blob=deleted_keys.append)
    segments.acknowledge_upload_cleanup(job, file_ids)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, shared_image.id) is not None
    assert deleted_keys == []


def test_replacement_preserves_file_with_external_owner(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    shared_image = _upload_file(key="shared-excel-image")
    chunks[0].page_content = f"![shared image](/files/{shared_image.id}/image-preview)"
    with sqlite_session_factory.begin() as session:
        session.add(shared_image)
        session.add(
            MessageFile(
                message_id="message-1",
                type=FileType.IMAGE,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="account-1",
                upload_file_id=shared_image.id,
            )
        )
    segments.save_for_indexing(job, chunks, [13, 17])
    segments.save_for_indexing(job, [chunks[1]], [23])

    file_ids = _cleanup_file_ids(sqlite_session_factory)
    deleted_keys: list[str] = []
    _reclaim_candidates(sqlite_session_factory, file_ids=file_ids, delete_blob=deleted_keys.append)
    segments.acknowledge_upload_cleanup(job, file_ids)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, shared_image.id) is not None
    assert deleted_keys == []


def test_replacement_commit_failure_preserves_old_owner_without_deleting_blob(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    old_image = _upload_file(key="old-excel-image")
    old_content = f"![old image](/files/{old_image.id}/image-preview)"
    chunks[0].page_content = old_content
    with sqlite_session_factory.begin() as session:
        session.add(old_image)
    segments.save_for_indexing(job, chunks, [13, 17])

    def fail_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(sqlite_session_factory.class_, "before_commit", fail_commit, once=True)
    replacement = [
        IndexDocument(
            page_content="replacement",
            metadata={"doc_id": "replacement-node", "doc_hash": "replacement-hash"},
            children=[],
        )
    ]
    with pytest.raises(RuntimeError, match="commit failed"):
        segments.save_for_indexing(job, replacement, [29])

    with sqlite_session_factory() as session:
        persisted = session.scalars(
            select(DocumentSegment).where(DocumentSegment.document_id == job.ref.document_id)
        ).all()
        assert any(segment.content == old_content for segment in persisted)
        assert session.get(UploadFile, old_image.id) is not None
        document = session.get_one(Document, job.ref.document_id)
        assert "_pending_upload_cleanup_ids" not in document.data_source_info_dict


def test_cleanup_ack_preserves_candidates_added_by_a_later_replacement(
    sqlite_session_factory: sessionmaker[Session], indexing_rows: IndexingRows
) -> None:
    segments, job, chunks = indexing_rows
    old_image = _upload_file(key="old-excel-image")
    chunks[0].page_content = f"![old image](/files/{old_image.id}/image-preview)"
    with sqlite_session_factory.begin() as session:
        session.add(old_image)
    segments.save_for_indexing(job, chunks, [13, 17])
    segments.save_for_indexing(job, [chunks[1]], [23])
    processed = _cleanup_file_ids(sqlite_session_factory)

    with sqlite_session_factory.begin() as session:
        document = session.get_one(Document, job.ref.document_id)
        source_info = document.data_source_info_dict
        source_info["_pending_upload_cleanup_ids"] = [*processed, "concurrent-file"]
        document.data_source_info = json.dumps(source_info)

    segments.acknowledge_upload_cleanup(job, processed)

    with sqlite_session_factory() as session:
        document = session.get_one(Document, job.ref.document_id)
        assert document.data_source_info_dict["_pending_upload_cleanup_ids"] == ["concurrent-file"]
