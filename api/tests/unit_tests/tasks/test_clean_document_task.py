"""Durable cleanup tests for deleted knowledge documents."""

import json
from collections.abc import Generator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol, cast
from uuid import uuid4

import pytest
from celery.exceptions import Reject
from sqlalchemy import event, select
from sqlalchemy.orm import Session

import tasks.clean_document_task as task_module
import tasks.knowledge_task_outbox_task as outbox_task_module
from extensions.storage.storage_type import StorageType
from models.dataset import (
    ChildChunk,
    Dataset,
    DatasetMetadataBinding,
    Document,
    DocumentSegment,
    DocumentSegmentSummary,
    SegmentAttachmentBinding,
)
from models.enums import CreatorUserRole, DataSourceType, IndexingStatus, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import KnowledgeUploadFileReference, UploadFile
from repositories.knowledge.upload_file_repository import (
    build_document_cleanup_manifest,
    guard_knowledge_owner_upload_references,
    replace_document_upload_file_references,
    replace_segment_image_upload_file_references,
    sync_knowledge_owner_upload_references,
)
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskDeliveryHandledError,
    KnowledgeTaskKind,
    KnowledgeTaskRequeuedError,
)
from tasks.batch_clean_document_task import batch_clean_document_task
from tasks.clean_document_task import clean_document_task
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_document

SQLITE_MODELS = (
    Dataset,
    Document,
    DocumentSegment,
    ChildChunk,
    DocumentSegmentSummary,
    SegmentAttachmentBinding,
    UploadFile,
    KnowledgeUploadFileReference,
    DatasetMetadataBinding,
    KnowledgeTaskOutbox,
)

pytestmark = pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)


@pytest.fixture(autouse=True)
def _enable_physical_cleanup(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=True)


@pytest.fixture(autouse=True)
def _registered_knowledge_owner_upload_reference_guards() -> Generator[None]:
    listeners = (
        ("before_insert", guard_knowledge_owner_upload_references),
        ("before_update", guard_knowledge_owner_upload_references),
        ("after_insert", sync_knowledge_owner_upload_references),
        ("after_update", sync_knowledge_owner_upload_references),
    )
    initial_state = {
        (model, operation, listener): event.contains(model, operation, listener)
        for model in (Document, DocumentSegment)
        for operation, listener in listeners
    }
    for model in (Document, DocumentSegment):
        for operation, listener in listeners:
            if not initial_state[(model, operation, listener)]:
                event.listen(model, operation, listener)
    yield
    for model in (Document, DocumentSegment):
        for operation, listener in listeners:
            if not initial_state[(model, operation, listener)]:
                event.remove(model, operation, listener)


class CleanupTaskConfig(Protocol):
    dont_autoretry_for: tuple[type[Exception], ...]


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
class PartialFailureStorage:
    existing_keys: set[str]
    transient_failure_key: str
    attempts: list[str] = field(default_factory=list)
    failed_once: bool = False

    def delete(self, key: str) -> None:
        self.attempts.append(key)
        if key not in self.existing_keys:
            raise FileNotFoundError(key)
        if key == self.transient_failure_key and not self.failed_once:
            self.failed_once = True
            raise RuntimeError("storage unavailable")
        self.existing_keys.remove(key)


def _upload_file(*, tenant_id: str, created_by: str, key: str) -> UploadFile:
    return UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=key,
        name=key.rsplit("/", 1)[-1],
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=created_by,
        created_at=datetime.now(UTC),
        used=True,
    )


def _document(*, tenant_id: str, dataset_id: str, created_by: str, position: int = 1) -> Document:
    return make_document(
        document_id=str(uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        name=f"document-{position}.txt",
        created_by=created_by,
        position=position,
    )


def _cleanup_intent(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
) -> KnowledgeTaskOutbox:
    intent = KnowledgeTaskOutbox(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        task_kind=KnowledgeTaskKind.DOCUMENT_CLEANUP,
        payload={},
        status="dispatched",
    )
    session.add(intent)
    session.commit()
    return intent


def _segment(*, document: Document, created_by: str, position: int = 1) -> DocumentSegment:
    return DocumentSegment(
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        position=position,
        content="segment content",
        word_count=2,
        tokens=2,
        created_by=created_by,
        index_node_id=f"node-{document.id}-{position}",
    )


def _persist_knowledge_graph(
    session: Session,
    *,
    dataset: Dataset,
    uploads: tuple[UploadFile, ...] = (),
    documents: tuple[Document, ...] = (),
    segments: tuple[DocumentSegment, ...] = (),
    dependents: tuple[object, ...] = (),
) -> None:
    session.add_all([dataset, *uploads])
    session.flush()
    for owners in (documents, segments, dependents):
        if owners:
            session.add_all(owners)
            session.flush()


@pytest.fixture
def _bound_sessions(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    engine = sqlite_session.get_bind()
    monkeypatch.setattr(
        task_module.session_factory,
        "create_session",
        lambda: Session(engine, expire_on_commit=False),
    )
    monkeypatch.setattr("services.knowledge.task_outbox.gateway.wake_knowledge_task_dispatcher", lambda: True)


@pytest.mark.usefixtures("_bound_sessions")
def test_uses_persisted_file_snapshot_after_dataset_was_deleted(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    created_by = str(uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Deleted dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
    )
    document = _document(tenant_id=tenant_id, dataset_id=dataset_id, created_by=created_by)
    segment = _segment(document=document, created_by=created_by)
    upload = _upload_file(tenant_id=tenant_id, created_by=created_by, key="documents/source.txt")
    binding = DatasetMetadataBinding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        metadata_id=str(uuid4()),
        document_id=document.id,
        created_by=created_by,
    )
    _persist_knowledge_graph(
        sqlite_session,
        dataset=dataset,
        uploads=(upload,),
        documents=(document,),
        segments=(segment,),
        dependents=(binding,),
    )
    sqlite_session.commit()
    manifest = build_document_cleanup_manifest(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=(document.id,),
        document_file_ids=(upload.id,),
    )
    document_id = document.id
    segment_id = segment.id
    upload_id = upload.id
    sqlite_session.delete(document)
    sqlite_session.delete(dataset)
    sqlite_session.commit()

    recorder = RecordingStorage()
    monkeypatch.setattr(task_module, "storage", recorder)

    clean_document_task(
        document_id=document_id,
        dataset_id=dataset_id,
        doc_form="text_model",
        file_id=upload_id,
        tenant_id=tenant_id,
        cleanup_manifest=manifest.to_payload(),
    )

    sqlite_session.expire_all()
    assert sqlite_session.get(DocumentSegment, segment_id) is None
    assert sqlite_session.get(UploadFile, upload_id) is None
    assert sqlite_session.scalars(select(DatasetMetadataBinding)).all() == []
    assert recorder.deleted_keys == ["documents/source.txt"]


@pytest.mark.usefixtures("_bound_sessions")
@pytest.mark.parametrize("batch", [False, True])
def test_detaches_one_binding_without_deleting_a_shared_attachment(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    batch: bool,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    created_by = str(uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Shared attachment dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
        indexing_technique="high_quality",
        is_multimodal=True,
    )
    target = _document(tenant_id=tenant_id, dataset_id=dataset_id, created_by=created_by)
    survivor = _document(tenant_id=tenant_id, dataset_id=dataset_id, created_by=created_by, position=2)
    target_segment = _segment(document=target, created_by=created_by)
    survivor_segment = _segment(document=survivor, created_by=created_by)
    target.indexing_status = IndexingStatus.COMPLETED
    survivor.indexing_status = IndexingStatus.COMPLETED
    target_segment.status = SegmentStatus.COMPLETED
    survivor_segment.status = SegmentStatus.COMPLETED
    attachment = _upload_file(tenant_id=tenant_id, created_by=created_by, key="attachments/shared.png")
    target_binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=target.id,
        segment_id=target_segment.id,
        attachment_id=attachment.id,
    )
    survivor_binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=survivor.id,
        segment_id=survivor_segment.id,
        attachment_id=attachment.id,
    )
    _persist_knowledge_graph(
        sqlite_session,
        dataset=dataset,
        uploads=(attachment,),
        documents=(target, survivor),
        segments=(target_segment, survivor_segment),
        dependents=(target_binding, survivor_binding),
    )
    sqlite_session.commit()
    manifest = build_document_cleanup_manifest(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=(target.id,),
        document_file_ids=(),
    )
    target_id = target.id
    target_binding_id = target_binding.id
    survivor_binding_id = survivor_binding.id
    attachment_id = attachment.id
    sqlite_session.delete(target)
    sqlite_session.commit()

    recorder = RecordingStorage()
    monkeypatch.setattr(task_module, "storage", recorder)

    if batch:
        batch_clean_document_task([target_id], dataset_id, "text_model", [], tenant_id, manifest.to_payload())
    else:
        clean_document_task(target_id, dataset_id, "text_model", None, tenant_id, manifest.to_payload())

    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, target_binding_id) is None
    assert sqlite_session.get(SegmentAttachmentBinding, survivor_binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None
    assert recorder.deleted_keys == []
    index_cleanup = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP)
    )
    assert index_cleanup is not None
    vector_node_ids = index_cleanup.payload["vector_node_ids"]
    assert isinstance(vector_node_ids, list)
    assert attachment_id not in vector_node_ids
    assert index_cleanup.payload["attachment_node_ids"] == []


@pytest.mark.usefixtures("_bound_sessions")
def test_preserves_upload_file_referenced_by_another_document(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    created_by = str(uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Shared source dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
    )
    target = _document(tenant_id=tenant_id, dataset_id=dataset_id, created_by=created_by)
    survivor = _document(tenant_id=tenant_id, dataset_id=dataset_id, created_by=created_by, position=2)
    segment = _segment(document=target, created_by=created_by)
    upload = _upload_file(tenant_id=tenant_id, created_by=created_by, key="documents/shared.txt")
    target.data_source_info = json.dumps({"upload_file_id": upload.id})
    survivor.data_source_info = json.dumps({"upload_file_id": upload.id})
    _persist_knowledge_graph(
        sqlite_session,
        dataset=dataset,
        uploads=(upload,),
        documents=(target, survivor),
        segments=(segment,),
    )
    for document in (target, survivor):
        replace_document_upload_file_references(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document.id,
            data_source_type=document.data_source_type,
            data_source_info=document.data_source_info_dict,
        )
    sqlite_session.commit()
    manifest = build_document_cleanup_manifest(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=(target.id,),
        document_file_ids=(upload.id,),
    )
    target_id = target.id
    upload_id = upload.id
    sqlite_session.delete(target)
    sqlite_session.commit()

    recorder = RecordingStorage()
    monkeypatch.setattr(task_module, "storage", recorder)

    clean_document_task(
        target_id,
        dataset_id,
        "text_model",
        upload_id,
        tenant_id,
        manifest.to_payload(),
    )

    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, upload_id) is not None
    assert recorder.deleted_keys == []


@pytest.mark.usefixtures("_bound_sessions")
@pytest.mark.parametrize("batch", [False, True])
def test_preserves_image_file_referenced_by_another_segment(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    batch: bool,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    created_by = str(uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Shared image dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
        indexing_technique="high_quality",
        index_struct='{"type":"pgvector"}',
    )
    target = _document(tenant_id=tenant_id, dataset_id=dataset_id, created_by=created_by)
    survivor = _document(tenant_id=tenant_id, dataset_id=dataset_id, created_by=created_by, position=2)
    image = _upload_file(tenant_id=tenant_id, created_by=created_by, key="images/shared.png")
    image_markdown = f"![image](https://example.test/files/{image.id}/image-preview)"
    target_segment = _segment(document=target, created_by=created_by)
    target_segment.content = image_markdown
    survivor_segment = _segment(document=survivor, created_by=created_by)
    survivor_segment.content = image_markdown
    target.indexing_status = IndexingStatus.COMPLETED
    survivor.indexing_status = IndexingStatus.COMPLETED
    target_segment.enabled = True
    target_segment.status = SegmentStatus.COMPLETED
    survivor_segment.enabled = True
    survivor_segment.status = SegmentStatus.COMPLETED
    _persist_knowledge_graph(
        sqlite_session,
        dataset=dataset,
        uploads=(image,),
        documents=(target, survivor),
        segments=(target_segment, survivor_segment),
    )
    for document, segment in ((target, target_segment), (survivor, survivor_segment)):
        replace_segment_image_upload_file_references(
            sqlite_session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document.id,
            segment_id=segment.id,
            content=segment.content,
        )
    sqlite_session.commit()
    manifest = build_document_cleanup_manifest(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=(target.id,),
        document_file_ids=(),
    )
    target_id = target.id
    survivor_segment_id = survivor_segment.id
    image_id = image.id
    sqlite_session.delete(target)
    sqlite_session.commit()

    recorder = RecordingStorage()
    monkeypatch.setattr(task_module, "storage", recorder)

    if batch:
        batch_clean_document_task([target_id], dataset_id, "text_model", [], tenant_id, manifest.to_payload())
    else:
        clean_document_task(
            target_id,
            dataset_id,
            "text_model",
            None,
            tenant_id,
            manifest.to_payload(),
        )

    sqlite_session.expire_all()
    assert sqlite_session.get(DocumentSegment, survivor_segment_id) is not None
    assert sqlite_session.get(UploadFile, image_id) is not None
    assert recorder.deleted_keys == []
    index_cleanup = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP)
    )
    assert index_cleanup is not None
    vector_node_ids = index_cleanup.payload["vector_node_ids"]
    assert isinstance(vector_node_ids, list)
    assert image_id not in vector_node_ids
    assert index_cleanup.payload["inline_image_node_ids"] == []


@pytest.mark.usefixtures("_bound_sessions")
def test_storage_failure_keeps_file_row_and_manifest_can_be_replayed(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    created_by = str(uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Retry dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
    )
    document = _document(tenant_id=tenant_id, dataset_id=dataset_id, created_by=created_by)
    segment = _segment(document=document, created_by=created_by)
    attachment = _upload_file(tenant_id=tenant_id, created_by=created_by, key="attachments/retry.png")
    binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document.id,
        segment_id=segment.id,
        attachment_id=attachment.id,
    )
    _persist_knowledge_graph(
        sqlite_session,
        dataset=dataset,
        uploads=(attachment,),
        documents=(document,),
        segments=(segment,),
        dependents=(binding,),
    )
    sqlite_session.commit()
    manifest = build_document_cleanup_manifest(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=(document.id,),
        document_file_ids=(),
    )
    document_id = document.id
    segment_id = segment.id
    binding_id = binding.id
    attachment_id = attachment.id
    sqlite_session.delete(document)
    sqlite_session.commit()

    recorder = RecordingStorage(failures_remaining=1)
    monkeypatch.setattr(task_module, "storage", recorder)

    with pytest.raises(RuntimeError, match="storage unavailable"):
        clean_document_task(
            document_id,
            dataset_id,
            "text_model",
            None,
            tenant_id,
            manifest.to_payload(),
        )

    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(DocumentSegment, segment_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is not None

    clean_document_task(
        document_id,
        dataset_id,
        "text_model",
        None,
        tenant_id,
        manifest.to_payload(),
    )

    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, attachment_id) is None
    assert recorder.deleted_keys == ["attachments/retry.png", "attachments/retry.png"]


@pytest.mark.usefixtures("_bound_sessions")
def test_replay_treats_already_deleted_storage_key_as_success(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    created_by = str(uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Partial storage cleanup dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
    )
    document = _document(tenant_id=tenant_id, dataset_id=dataset_id, created_by=created_by)
    source = _upload_file(tenant_id=tenant_id, created_by=created_by, key="documents/source.txt")
    image = _upload_file(tenant_id=tenant_id, created_by=created_by, key="images/retry.png")
    segment = _segment(document=document, created_by=created_by)
    segment.content = f"![image](https://example.test/files/{image.id}/image-preview)"
    _persist_knowledge_graph(
        sqlite_session,
        dataset=dataset,
        uploads=(source, image),
        documents=(document,),
        segments=(segment,),
    )
    sqlite_session.commit()
    manifest = build_document_cleanup_manifest(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=(document.id,),
        document_file_ids=(source.id,),
    )
    document_id = document.id
    source_id = source.id
    image_id = image.id
    source_key = source.key
    image_key = image.key
    sqlite_session.delete(document)
    sqlite_session.commit()

    recorder = PartialFailureStorage(
        existing_keys={source_key, image_key},
        transient_failure_key=image_key,
    )
    monkeypatch.setattr(task_module, "storage", recorder)

    with pytest.raises(RuntimeError, match="storage unavailable"):
        clean_document_task(
            document_id,
            dataset_id,
            "text_model",
            source_id,
            tenant_id,
            manifest.to_payload(),
        )

    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, source_id) is not None
    assert sqlite_session.get(UploadFile, image_id) is not None

    clean_document_task(
        document_id,
        dataset_id,
        "text_model",
        source_id,
        tenant_id,
        manifest.to_payload(),
    )

    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, source_id) is None
    assert sqlite_session.get(UploadFile, image_id) is None
    assert recorder.existing_keys == set()
    assert recorder.attempts == [source_key, image_key, source_key, image_key]


@pytest.mark.usefixtures("_bound_sessions")
def test_index_cleanup_is_persisted_without_blocking_relational_cleanup(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    created_by = str(uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Index retry dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
    )
    document = _document(tenant_id=tenant_id, dataset_id=dataset_id, created_by=created_by)
    segment = _segment(document=document, created_by=created_by)
    _persist_knowledge_graph(
        sqlite_session,
        dataset=dataset,
        documents=(document,),
        segments=(segment,),
    )
    sqlite_session.commit()
    segment_id = segment.id
    document_id = document.id
    sqlite_session.delete(document)
    sqlite_session.commit()

    recorder = RecordingStorage()
    monkeypatch.setattr(task_module, "storage", recorder)
    clean_document_task(document_id, dataset_id, "text_model", None, tenant_id, {})

    sqlite_session.expire_all()
    assert sqlite_session.get(DocumentSegment, segment_id) is None
    assert recorder.deleted_keys == []
    index_cleanup = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP)
    )
    assert index_cleanup is not None
    assert index_cleanup.payload["vector_node_ids"] == [f"node-{document_id}-1"]


@pytest.mark.usefixtures("_bound_sessions")
def test_outbox_backed_document_cleanup_records_completion_and_failure(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    completed_document_id = str(uuid4())
    failed_document_id = str(uuid4())
    completed = _cleanup_intent(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=completed_document_id,
    )
    failed = _cleanup_intent(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=failed_document_id,
    )
    completed_intent_id = completed.id
    failed_intent_id = failed.id

    def clean_documents(*, document_ids: tuple[str, ...], **_: object) -> None:
        if failed_document_id in document_ids:
            raise RuntimeError("vector unavailable")

    monkeypatch.setattr(task_module, "_clean_documents", clean_documents)
    monkeypatch.setattr(outbox_task_module, "wake_knowledge_task_dispatcher", lambda: True)

    clean_document_task(
        completed_document_id,
        dataset_id,
        "text_model",
        None,
        tenant_id,
        {},
        completed_intent_id,
    )
    with pytest.raises(KnowledgeTaskRequeuedError, match=failed_intent_id):
        clean_document_task(
            failed_document_id,
            dataset_id,
            "text_model",
            None,
            tenant_id,
            {},
            failed_intent_id,
        )

    sqlite_session.expire_all()
    completed = sqlite_session.get(KnowledgeTaskOutbox, completed_intent_id)
    failed = sqlite_session.get(KnowledgeTaskOutbox, failed_intent_id)
    assert completed is not None
    assert completed.status == "completed"
    assert completed.last_error is None
    assert failed is not None
    assert failed.status == "pending"
    assert failed.last_error == "vector unavailable"
    assert failed.dispatched_at is None
    single = cast(CleanupTaskConfig, clean_document_task)
    batch = cast(CleanupTaskConfig, batch_clean_document_task)
    assert single.dont_autoretry_for == (KnowledgeTaskDeliveryHandledError, Reject)
    assert batch.dont_autoretry_for == (KnowledgeTaskDeliveryHandledError, Reject)
