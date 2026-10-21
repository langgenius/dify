"""Durable, tenant-scoped cleanup tests for deleted datasets."""

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

import tasks.clean_dataset_task as task_module
import tasks.knowledge_task_outbox_task as outbox_task_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.workflow.file_reference import build_file_reference
from extensions.storage.storage_type import StorageType
from models.dataset import (
    Document,
    DocumentSegment,
    DocumentSegmentSummary,
    ExternalKnowledgeBindings,
    SegmentAttachmentBinding,
)
from models.enums import CreatorUserRole, DataSourceType, TagType
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import Tag, TagBinding, UploadFile
from repositories.knowledge.dataset_repository import build_dataset_cleanup_manifest
from repositories.knowledge.upload_file_repository import (
    replace_document_upload_file_references,
    replace_segment_image_upload_file_references,
)
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind, KnowledgeTaskRequeuedError
from tasks.clean_dataset_task import _clean_dataset, clean_dataset_task
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_document


@dataclass
class RecordingStorage:
    failures_remaining: int = 0
    deleted_keys: list[str] = field(default_factory=list)

    def delete(self, key: str) -> None:
        self.deleted_keys.append(key)
        if self.failures_remaining:
            self.failures_remaining -= 1
            raise RuntimeError("storage unavailable")


@dataclass
class CleanupRuntime:
    storage: RecordingStorage
    crawl_cleanups: list[tuple[str, str]]


@pytest.fixture(autouse=True)
def _enable_physical_cleanup(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=True)


@pytest.fixture
def runtime(monkeypatch: pytest.MonkeyPatch) -> CleanupRuntime:
    storage = RecordingStorage()
    crawl_cleanups: list[tuple[str, str]] = []
    monkeypatch.setattr(task_module, "storage", storage)
    monkeypatch.setattr("services.knowledge.task_outbox.gateway.wake_knowledge_task_dispatcher", lambda: True)
    monkeypatch.setattr(
        task_module,
        "cleanup_dataset_crawl_cache",
        lambda tenant_id, dataset_id, **_kwargs: crawl_cleanups.append((tenant_id, dataset_id)),
    )
    return CleanupRuntime(storage, crawl_cleanups)


def _upload_file(*, tenant_id: str, key: str) -> UploadFile:
    return UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=key,
        name=key.rsplit("/", 1)[-1],
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        created_at=datetime.now(UTC),
        used=True,
    )


def _document(
    *,
    tenant_id: str,
    dataset_id: str,
    upload_file_id: str | None = None,
    position: int = 1,
) -> Document:
    return make_document(
        document_id=str(uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=position,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info=json.dumps({"upload_file_id": upload_file_id}) if upload_file_id else None,
        created_by=str(uuid4()),
    )


def _segment(*, document: Document, content: str = "content") -> DocumentSegment:
    return DocumentSegment(
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        position=1,
        content=content,
        word_count=1,
        tokens=1,
        created_by=document.created_by,
        index_node_id=str(uuid4()),
    )


def _summary(*, document: Document, segment: DocumentSegment) -> DocumentSegmentSummary:
    return DocumentSegmentSummary(
        dataset_id=document.dataset_id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content="summary",
        summary_index_node_id=str(uuid4()),
    )


def _attachment_binding(
    *,
    document: Document,
    segment: DocumentSegment,
    attachment: UploadFile,
) -> SegmentAttachmentBinding:
    return SegmentAttachmentBinding(
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        segment_id=segment.id,
        attachment_id=attachment.id,
    )


def _run_cleanup(
    *,
    tenant_id: str,
    dataset_id: str,
    manifest: dict[str, object],
) -> None:
    _clean_dataset(
        dataset_id=dataset_id,
        tenant_id=tenant_id,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        index_struct='{"type": "paragraph"}',
        collection_binding_id=str(uuid4()),
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        manifest=manifest,
    )


def _empty_manifest() -> dict[str, object]:
    return {
        "document_ids": [],
        "segment_ids": [],
        "document_files": [],
        "image_files": [],
        "segment_attachments": [],
    }


def _persist_cleanup_intent(
    session_factory: sessionmaker[Session],
    *,
    tenant_id: str,
    dataset_id: str,
) -> str:
    intent = KnowledgeTaskOutbox(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        resource_id=dataset_id,
        task_kind=KnowledgeTaskKind.DATASET_CLEANUP,
        payload={"manifest": _empty_manifest()},
        status="dispatched",
    )
    with session_factory.begin() as session:
        session.add(intent)
    return intent.id


def test_manifest_snapshots_only_tenant_owned_documents_segments_and_files(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id = str(uuid4())
    foreign_tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    source = _upload_file(tenant_id=tenant_id, key="documents/source.txt")
    image = _upload_file(tenant_id=tenant_id, key="images/own.png")
    attachment = _upload_file(tenant_id=tenant_id, key="attachments/own.txt")
    foreign_source = _upload_file(tenant_id=foreign_tenant_id, key="documents/foreign.txt")
    foreign_image = _upload_file(tenant_id=foreign_tenant_id, key="images/foreign.png")
    foreign_attachment = _upload_file(tenant_id=foreign_tenant_id, key="attachments/foreign.txt")
    document = _document(tenant_id=tenant_id, dataset_id=dataset_id, upload_file_id=source.id)
    missing_owned_file = _document(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        upload_file_id=foreign_source.id,
        position=2,
    )
    segment = _segment(
        document=document,
        content=f"![image](https://example.test/files/{image.id}/image-preview)",
    )
    binding = _attachment_binding(document=document, segment=segment, attachment=attachment)
    foreign_document = _document(
        tenant_id=foreign_tenant_id,
        dataset_id=dataset_id,
        upload_file_id=foreign_source.id,
    )
    foreign_segment = _segment(
        document=foreign_document,
        content=f"![image](https://example.test/files/{foreign_image.id}/image-preview)",
    )
    foreign_binding = _attachment_binding(
        document=foreign_document,
        segment=foreign_segment,
        attachment=foreign_attachment,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                source,
                image,
                attachment,
                foreign_source,
                foreign_image,
                foreign_attachment,
                document,
                missing_owned_file,
                segment,
                binding,
                foreign_document,
                foreign_segment,
                foreign_binding,
            ]
        )

    with sqlite_session_factory() as session:
        manifest = build_dataset_cleanup_manifest(session, tenant_id=tenant_id, dataset_id=dataset_id)

    assert manifest["document_ids"] == sorted([document.id, missing_owned_file.id])
    assert manifest["segment_ids"] == [segment.id]
    assert manifest["document_files"] == [
        {"id": file_id, "key": key}
        for _, file_id, key in sorted(
            [
                (document.id, source.id, source.key),
                (missing_owned_file.id, foreign_source.id, None),
            ]
        )
    ]
    assert manifest["image_files"] == [{"id": image.id, "key": image.key}]
    assert manifest["segment_attachments"] == [
        {"binding_id": binding.id, "attachment_id": attachment.id, "key": attachment.key}
    ]


def test_cleanup_uses_manifest_after_dataset_delete_and_preserves_foreign_tenant_rows(
    sqlite_session_factory: sessionmaker[Session],
    runtime: CleanupRuntime,
) -> None:
    tenant_id = str(uuid4())
    foreign_tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    source = _upload_file(tenant_id=tenant_id, key="documents/source.txt")
    image = _upload_file(tenant_id=tenant_id, key="images/own.png")
    attachment = _upload_file(tenant_id=tenant_id, key="attachments/own.txt")
    document = _document(tenant_id=tenant_id, dataset_id=dataset_id, upload_file_id=source.id)
    segment = _segment(
        document=document,
        content=f"![image](https://example.test/files/{image.id}/file-preview)",
    )
    binding = _attachment_binding(document=document, segment=segment, attachment=attachment)
    summary = _summary(document=document, segment=segment)
    foreign_file = _upload_file(tenant_id=foreign_tenant_id, key="documents/foreign.txt")
    foreign_document = _document(
        tenant_id=foreign_tenant_id,
        dataset_id=dataset_id,
        upload_file_id=foreign_file.id,
    )
    foreign_segment = _segment(document=foreign_document)
    foreign_summary = _summary(document=foreign_document, segment=foreign_segment)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                source,
                image,
                attachment,
                document,
                segment,
                summary,
                binding,
                foreign_file,
                foreign_document,
                foreign_segment,
                foreign_summary,
            ]
        )
    with sqlite_session_factory() as session:
        manifest = build_dataset_cleanup_manifest(session, tenant_id=tenant_id, dataset_id=dataset_id)

    _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=manifest)

    with sqlite_session_factory() as session:
        assert session.get(Document, document.id) is None
        assert session.get(DocumentSegment, segment.id) is None
        assert session.get(DocumentSegmentSummary, summary.id) is None
        assert session.get(SegmentAttachmentBinding, binding.id) is None
        assert session.get(UploadFile, source.id) is None
        assert session.get(UploadFile, image.id) is None
        assert session.get(UploadFile, attachment.id) is None
        assert session.get(Document, foreign_document.id) is not None
        assert session.get(DocumentSegment, foreign_segment.id) is not None
        assert session.get(DocumentSegmentSummary, foreign_summary.id) is not None
        assert session.get(UploadFile, foreign_file.id) is not None
    assert set(runtime.storage.deleted_keys) == {source.key, image.key, attachment.key}
    assert runtime.crawl_cleanups == [(tenant_id, dataset_id)]
    with sqlite_session_factory() as session:
        index_cleanup = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP)
        )
        assert index_cleanup is not None
        assert index_cleanup.payload["delete_all"] is True


def test_shared_attachment_is_not_deleted(
    sqlite_session_factory: sessionmaker[Session],
    runtime: CleanupRuntime,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    survivor_dataset_id = str(uuid4())
    target = _document(tenant_id=tenant_id, dataset_id=dataset_id)
    target_segment = _segment(document=target)
    survivor = _document(tenant_id=tenant_id, dataset_id=survivor_dataset_id)
    survivor_segment = _segment(document=survivor)
    attachment = _upload_file(tenant_id=tenant_id, key="attachments/shared.txt")
    target_binding = _attachment_binding(document=target, segment=target_segment, attachment=attachment)
    survivor_binding = _attachment_binding(document=survivor, segment=survivor_segment, attachment=attachment)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                target,
                target_segment,
                survivor,
                survivor_segment,
                attachment,
                target_binding,
                survivor_binding,
            ]
        )
    with sqlite_session_factory() as session:
        manifest = build_dataset_cleanup_manifest(session, tenant_id=tenant_id, dataset_id=dataset_id)

    _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=manifest)

    with sqlite_session_factory() as session:
        assert session.get(SegmentAttachmentBinding, target_binding.id) is None
        assert session.get(SegmentAttachmentBinding, survivor_binding.id) is not None
        assert session.get(UploadFile, attachment.id) is not None
    assert runtime.storage.deleted_keys == []


def test_files_referenced_by_surviving_document_and_segment_are_not_deleted(
    sqlite_session_factory: sessionmaker[Session],
    runtime: CleanupRuntime,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    survivor_dataset_id = str(uuid4())
    source = _upload_file(tenant_id=tenant_id, key="documents/shared.txt")
    image = _upload_file(tenant_id=tenant_id, key="images/shared.png")
    target = _document(tenant_id=tenant_id, dataset_id=dataset_id, upload_file_id=source.id)
    target_segment = _segment(
        document=target,
        content=f"![image](https://example.test/files/{image.id}/image-preview)",
    )
    survivor = _document(
        tenant_id=tenant_id,
        dataset_id=survivor_dataset_id,
        upload_file_id=source.id,
    )
    survivor_segment = _segment(
        document=survivor,
        content=f"![image](https://example.test/files/{image.id}/image-preview)",
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([source, image, target, target_segment, survivor, survivor_segment])
        session.flush()
        for document, segment in ((target, target_segment), (survivor, survivor_segment)):
            replace_document_upload_file_references(
                session,
                tenant_id=tenant_id,
                dataset_id=document.dataset_id,
                document_id=document.id,
                data_source_type=document.data_source_type,
                data_source_info=document.data_source_info_dict,
            )
            replace_segment_image_upload_file_references(
                session,
                tenant_id=tenant_id,
                dataset_id=document.dataset_id,
                document_id=document.id,
                segment_id=segment.id,
                content=segment.content,
            )
    with sqlite_session_factory() as session:
        manifest = build_dataset_cleanup_manifest(session, tenant_id=tenant_id, dataset_id=dataset_id)

    _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=manifest)

    with sqlite_session_factory() as session:
        assert session.get(Document, target.id) is None
        assert session.get(DocumentSegment, target_segment.id) is None
        assert session.get(Document, survivor.id) is not None
        assert session.get(DocumentSegment, survivor_segment.id) is not None
        assert session.get(UploadFile, source.id) is not None
        assert session.get(UploadFile, image.id) is not None
    assert runtime.storage.deleted_keys == []


def test_local_file_reference_is_included_in_dataset_cleanup_manifest(
    sqlite_session_factory: sessionmaker[Session],
    runtime: CleanupRuntime,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    source = _upload_file(tenant_id=tenant_id, key="pipeline/local-source.txt")
    document = make_document(
        document_id=str(uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        data_source_type=DataSourceType.LOCAL_FILE,
        data_source_info=json.dumps({"reference": build_file_reference(record_id=source.id)}),
        created_by=str(uuid4()),
    )
    segment = _segment(document=document)
    with sqlite_session_factory.begin() as session:
        session.add_all([source, document, segment])
        session.flush()
        replace_document_upload_file_references(
            session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document.id,
            data_source_type=document.data_source_type,
            data_source_info=document.data_source_info_dict,
        )
    with sqlite_session_factory() as session:
        manifest = build_dataset_cleanup_manifest(session, tenant_id=tenant_id, dataset_id=dataset_id)

    assert manifest["document_files"] == [{"id": source.id, "key": source.key}]

    _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=manifest)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, source.id) is None
        assert session.get(Document, document.id) is None
    assert runtime.storage.deleted_keys == [source.key]


def test_storage_failure_preserves_replay_state_and_manifest_can_be_reused(
    sqlite_session_factory: sessionmaker[Session],
    runtime: CleanupRuntime,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document = _document(tenant_id=tenant_id, dataset_id=dataset_id)
    segment = _segment(document=document)
    attachment = _upload_file(tenant_id=tenant_id, key="attachments/retry.txt")
    binding = _attachment_binding(document=document, segment=segment, attachment=attachment)
    with sqlite_session_factory.begin() as session:
        session.add_all([document, segment, attachment, binding])
    with sqlite_session_factory() as session:
        manifest = build_dataset_cleanup_manifest(session, tenant_id=tenant_id, dataset_id=dataset_id)

    runtime.storage.failures_remaining = 1
    with pytest.raises(RuntimeError, match="storage unavailable"):
        _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=manifest)

    with sqlite_session_factory() as session:
        assert session.get(SegmentAttachmentBinding, binding.id) is None
        assert session.get(UploadFile, attachment.id) is not None
        assert session.get(Document, document.id) is not None
        assert session.get(DocumentSegment, segment.id) is not None
    _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=manifest)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, attachment.id) is None
        assert session.get(Document, document.id) is None
        assert session.get(DocumentSegment, segment.id) is None
    assert runtime.storage.deleted_keys == [attachment.key, attachment.key]


def test_vector_cleanup_is_persisted_without_blocking_relational_cleanup(
    sqlite_session_factory: sessionmaker[Session],
    runtime: CleanupRuntime,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    source = _upload_file(tenant_id=tenant_id, key="documents/source.txt")
    document = _document(tenant_id=tenant_id, dataset_id=dataset_id, upload_file_id=source.id)
    segment = _segment(document=document)
    summary = _summary(document=document, segment=segment)
    with sqlite_session_factory.begin() as session:
        session.add_all([source, document, segment, summary])
    with sqlite_session_factory() as session:
        manifest = build_dataset_cleanup_manifest(session, tenant_id=tenant_id, dataset_id=dataset_id)

    _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=manifest)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, source.id) is None
        assert session.get(DocumentSegmentSummary, summary.id) is None
        assert session.get(DocumentSegment, segment.id) is None
        assert session.get(Document, document.id) is None
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP)
        )
        assert intent is not None
        assert intent.payload["delete_all"] is True
    assert runtime.crawl_cleanups == [(tenant_id, dataset_id)]


def test_relational_commit_failure_raises_and_same_manifest_converges_on_retry(
    sqlite_session_factory: sessionmaker[Session],
    runtime: CleanupRuntime,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    source = _upload_file(tenant_id=tenant_id, key="documents/retry.txt")
    document = _document(tenant_id=tenant_id, dataset_id=dataset_id, upload_file_id=source.id)
    segment = _segment(document=document)
    summary = _summary(document=document, segment=segment)
    with sqlite_session_factory.begin() as session:
        session.add_all([source, document, segment, summary])
    with sqlite_session_factory() as session:
        manifest = build_dataset_cleanup_manifest(session, tenant_id=tenant_id, dataset_id=dataset_id)

    commit_count = 0

    def fail_second_commit(_session: Session) -> None:
        nonlocal commit_count
        commit_count += 1
        if commit_count == 2:
            raise RuntimeError("commit unavailable")

    event.listen(sqlite_session_factory.class_, "before_commit", fail_second_commit)
    try:
        with pytest.raises(RuntimeError, match="commit unavailable"):
            _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=manifest)
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", fail_second_commit)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, source.id) is not None
        assert session.get(Document, document.id) is not None
        assert session.get(DocumentSegment, segment.id) is not None
        assert session.get(DocumentSegmentSummary, summary.id) is not None
    assert runtime.storage.deleted_keys == []
    _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=manifest)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, source.id) is None
        assert session.get(Document, document.id) is None
        assert session.get(DocumentSegment, segment.id) is None
        assert session.get(DocumentSegmentSummary, summary.id) is None
    assert runtime.storage.deleted_keys == [source.key]


def test_second_segment_batch_failure_preserves_committed_progress_and_retry_converges(
    sqlite_session_factory: sessionmaker[Session],
    runtime: CleanupRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del runtime
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document = _document(tenant_id=tenant_id, dataset_id=dataset_id)
    segments = [_segment(document=document) for _ in range(5)]
    for position, segment in enumerate(segments, start=1):
        segment.position = position
    with sqlite_session_factory.begin() as session:
        session.add_all([document, *segments])
    with sqlite_session_factory() as session:
        manifest = build_dataset_cleanup_manifest(session, tenant_id=tenant_id, dataset_id=dataset_id)
        engine = session.get_bind()

    monkeypatch.setattr(task_module, "_DELETE_BATCH_SIZE", 2)
    segment_delete_count = 0

    def record_segment_delete(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        nonlocal segment_delete_count
        if statement.lower().startswith("delete from document_segments"):
            segment_delete_count += 1

    def fail_second_segment_commit(_session: Session) -> None:
        if segment_delete_count == 2:
            raise RuntimeError("second segment batch commit failed")

    event.listen(engine, "before_cursor_execute", record_segment_delete)
    event.listen(sqlite_session_factory.class_, "before_commit", fail_second_segment_commit)
    try:
        with pytest.raises(RuntimeError, match="second segment batch commit failed"):
            _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=manifest)
    finally:
        event.remove(engine, "before_cursor_execute", record_segment_delete)
        event.remove(sqlite_session_factory.class_, "before_commit", fail_second_segment_commit)

    with sqlite_session_factory() as session:
        assert session.get(Document, document.id) is not None
        assert sum(session.get(DocumentSegment, segment.id) is not None for segment in segments) == 3

    _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=manifest)

    with sqlite_session_factory() as session:
        assert session.get(Document, document.id) is None
        assert all(session.get(DocumentSegment, segment.id) is None for segment in segments)


def test_documents_are_deleted_in_bounded_batches(
    sqlite_session_factory: sessionmaker[Session],
    runtime: CleanupRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del runtime
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    documents = [_document(tenant_id=tenant_id, dataset_id=dataset_id, position=position) for position in range(1, 6)]
    with sqlite_session_factory.begin() as session:
        session.add_all(documents)
    with sqlite_session_factory() as session:
        manifest = build_dataset_cleanup_manifest(session, tenant_id=tenant_id, dataset_id=dataset_id)
        engine = session.get_bind()

    monkeypatch.setattr(task_module, "_DELETE_BATCH_SIZE", 2)
    document_delete_count = 0

    def record_document_delete(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        nonlocal document_delete_count
        if statement.lower().startswith("delete from documents"):
            document_delete_count += 1

    event.listen(engine, "before_cursor_execute", record_document_delete)
    try:
        _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=manifest)
    finally:
        event.remove(engine, "before_cursor_execute", record_document_delete)

    assert document_delete_count == 3
    with sqlite_session_factory() as session:
        assert all(session.get(Document, document.id) is None for document in documents)


def test_task_retries_and_uses_late_acknowledgement() -> None:
    assert clean_dataset_task.acks_late is True
    assert clean_dataset_task.reject_on_worker_lost is True
    assert clean_dataset_task.max_retries == 5


def test_cleanup_removes_external_and_knowledge_tag_relationships_only_for_owned_dataset(
    sqlite_session_factory: sessionmaker[Session],
    runtime: CleanupRuntime,
) -> None:
    del runtime
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    actor_id = str(uuid4())
    knowledge_tag = Tag(
        tenant_id=tenant_id,
        type=TagType.KNOWLEDGE,
        name="Knowledge",
        created_by=actor_id,
    )
    app_tag = Tag(
        tenant_id=tenant_id,
        type=TagType.APP,
        name="App",
        created_by=actor_id,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([knowledge_tag, app_tag])
        session.flush()
        external_binding = ExternalKnowledgeBindings(
            tenant_id=tenant_id,
            external_knowledge_api_id=str(uuid4()),
            dataset_id=dataset_id,
            external_knowledge_id="remote-dataset",
            created_by=actor_id,
        )
        knowledge_binding = TagBinding(
            tenant_id=tenant_id,
            tag_id=knowledge_tag.id,
            target_id=dataset_id,
            created_by=actor_id,
        )
        retained_app_binding = TagBinding(
            tenant_id=tenant_id,
            tag_id=app_tag.id,
            target_id=dataset_id,
            created_by=actor_id,
        )
        session.add_all([external_binding, knowledge_binding, retained_app_binding])
        session.flush()
        external_binding_id = external_binding.id
        knowledge_binding_id = knowledge_binding.id
        retained_app_binding_id = retained_app_binding.id

    _run_cleanup(tenant_id=tenant_id, dataset_id=dataset_id, manifest=_empty_manifest())

    with sqlite_session_factory() as session:
        assert session.get(ExternalKnowledgeBindings, external_binding_id) is None
        assert session.get(TagBinding, knowledge_binding_id) is None
        assert session.get(TagBinding, retained_app_binding_id) is not None


def test_outbox_backed_cleanup_marks_intent_completed(
    sqlite_session_factory: sessionmaker[Session],
    runtime: CleanupRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del runtime
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    intent_id = _persist_cleanup_intent(
        sqlite_session_factory,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
    )
    monkeypatch.setattr(outbox_task_module, "wake_knowledge_task_dispatcher", lambda: True)

    clean_dataset_task(
        dataset_id,
        tenant_id,
        IndexTechniqueType.HIGH_QUALITY,
        None,
        None,
        IndexStructureType.PARAGRAPH_INDEX,
        None,
        _empty_manifest(),
        intent_id,
    )

    with sqlite_session_factory() as session:
        intent = session.get(KnowledgeTaskOutbox, intent_id)
        assert intent is not None
        assert intent.status == "completed"
        assert intent.last_error is None


def test_outbox_backed_failure_is_durably_requeued_without_celery_autoretry(
    sqlite_session_factory: sessionmaker[Session],
    runtime: CleanupRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del runtime
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    intent_id = _persist_cleanup_intent(
        sqlite_session_factory,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
    )

    def fail_storage(_files: object, **_kwargs: object) -> None:
        raise RuntimeError("storage unavailable")

    monkeypatch.setattr(task_module, "_storage_delete", fail_storage)
    monkeypatch.setattr(outbox_task_module, "wake_knowledge_task_dispatcher", lambda: True)

    with pytest.raises(KnowledgeTaskRequeuedError, match=intent_id):
        clean_dataset_task(
            dataset_id,
            tenant_id,
            IndexTechniqueType.HIGH_QUALITY,
            None,
            None,
            IndexStructureType.PARAGRAPH_INDEX,
            None,
            _empty_manifest(),
            intent_id,
        )

    with sqlite_session_factory() as session:
        intent = session.get(KnowledgeTaskOutbox, intent_id)
        assert intent is not None
        assert intent.status == "pending"
        assert intent.last_error == "storage unavailable"
        assert intent.dispatched_at is None
