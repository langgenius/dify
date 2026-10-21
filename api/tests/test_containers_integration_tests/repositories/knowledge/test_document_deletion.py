"""Database integration coverage for durable document deletion."""

import datetime
import json
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from threading import Event, get_ident
from typing import cast
from uuid import uuid4

from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import UploadFile
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.indexing.cleanup import DocumentCleanupManifest
from services.knowledge.resource_scope import DatasetRef

FIXED_UPLOAD_CREATED_AT = datetime.datetime(2024, 1, 1)


class DocumentLifecycleFactory:
    @staticmethod
    def create_dataset(session: Session) -> Dataset:
        creator_id = str(uuid4())
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name=f"dataset-{uuid4()}",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=creator_id,
            maintainer=creator_id,
        )
        session.add(dataset)
        session.commit()
        return dataset

    @staticmethod
    def create_document(
        session: Session,
        *,
        dataset: Dataset,
        position: int = 1,
        data_source_info: dict[str, object] | None = None,
    ) -> Document:
        document = Document(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=position,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info=json.dumps(data_source_info or {}),
            batch=f"batch-{uuid4()}",
            name=f"document-{uuid4()}.txt",
            created_from=DocumentCreatedFrom.WEB,
            created_by=dataset.created_by,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            indexing_status=IndexingStatus.COMPLETED,
            completed_at=FIXED_UPLOAD_CREATED_AT,
            enabled=True,
            archived=False,
        )
        session.add(document)
        session.commit()
        return document

    @staticmethod
    def create_upload_file(session: Session, *, dataset: Dataset, name: str) -> UploadFile:
        upload_file = UploadFile(
            tenant_id=dataset.tenant_id,
            storage_type=StorageType.LOCAL,
            key=f"uploads/{uuid4()}",
            name=name,
            size=128,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=dataset.created_by,
            created_at=FIXED_UPLOAD_CREATED_AT,
            used=False,
        )
        session.add(upload_file)
        session.commit()
        return upload_file


def _repository(session: Session) -> SQLAlchemyDocumentRepository:
    return SQLAlchemyDocumentRepository(
        session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False),
        wake_after_commit=lambda _session: None,
    )


def test_delete_document_persists_cleanup_manifest(db_session_with_containers: Session) -> None:
    dataset = DocumentLifecycleFactory.create_dataset(db_session_with_containers)
    upload_file = DocumentLifecycleFactory.create_upload_file(
        db_session_with_containers,
        dataset=dataset,
        name="source.txt",
    )
    document = DocumentLifecycleFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_info={"upload_file_id": upload_file.id},
    )
    ref = DatasetRef(dataset.tenant_id, dataset.id).document(document.id)

    assert _repository(db_session_with_containers).delete_document(ref) is True

    db_session_with_containers.expire_all()
    assert db_session_with_containers.get(Document, document.id) is None
    intent = db_session_with_containers.scalar(
        select(KnowledgeTaskOutbox).where(
            KnowledgeTaskOutbox.task_kind == "document_cleanup",
            KnowledgeTaskOutbox.document_id == document.id,
        )
    )
    assert intent is not None
    assert intent.payload["cleanup_manifest"] == {
        "document_files": [{"id": upload_file.id, "key": upload_file.key}],
        "image_files": [],
        "segment_attachments": [],
    }


def test_delete_document_waits_for_writer_and_snapshots_committed_children(
    db_session_with_containers: Session,
) -> None:
    dataset = DocumentLifecycleFactory.create_dataset(db_session_with_containers)
    original_source = DocumentLifecycleFactory.create_upload_file(
        db_session_with_containers, dataset=dataset, name="original.txt"
    )
    committed_source = DocumentLifecycleFactory.create_upload_file(
        db_session_with_containers, dataset=dataset, name="committed.txt"
    )
    image = DocumentLifecycleFactory.create_upload_file(db_session_with_containers, dataset=dataset, name="image.png")
    attachment = DocumentLifecycleFactory.create_upload_file(
        db_session_with_containers, dataset=dataset, name="attachment.png"
    )
    document = DocumentLifecycleFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_info={"upload_file_id": original_source.id},
    )
    document_id = document.id
    dataset_id = dataset.id
    tenant_id = dataset.tenant_id
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    writer_locked = Event()
    delete_lock_requested = Event()
    deleting_thread_id: int | None = None

    def observe_delete_lock(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if get_ident() == deleting_thread_id and "FROM documents" in statement and "FOR UPDATE" in statement:
            delete_lock_requested.set()

    def write_segment() -> tuple[str, str]:
        with sessions.begin() as session:
            locked_document = session.scalar(
                select(Document).where(Document.id == document_id).with_for_update(of=Document)
            )
            assert locked_document is not None
            writer_locked.set()
            assert delete_lock_requested.wait(timeout=10)
            locked_document.doc_form = IndexStructureType.QA_INDEX
            locked_document.data_source_info = json.dumps({"upload_file_id": committed_source.id})
            segment = DocumentSegment(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
                position=1,
                content=f"![image](https://example.test/files/{image.id}/image-preview)",
                word_count=1,
                tokens=1,
                created_by=document.created_by,
                index_node_id=str(uuid4()),
            )
            binding = SegmentAttachmentBinding(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
                segment_id=segment.id,
                attachment_id=attachment.id,
            )
            session.add_all([segment, binding])
            session.flush()
            return segment.id, binding.id

    def delete_document() -> None:
        nonlocal deleting_thread_id
        assert writer_locked.wait(timeout=10)
        deleting_thread_id = get_ident()
        repository = SQLAlchemyDocumentRepository(session_factory=sessions, wake_after_commit=lambda _session: None)
        assert repository.delete_document(DatasetRef(tenant_id, dataset_id).document(document_id)) is True

    engine = db_session_with_containers.get_bind()
    event.listen(engine, "before_cursor_execute", observe_delete_lock)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            writer = executor.submit(write_segment)
            deleter = executor.submit(delete_document)
            segment_id, binding_id = writer.result(timeout=30)
            deleter.result(timeout=30)
    finally:
        event.remove(engine, "before_cursor_execute", observe_delete_lock)

    db_session_with_containers.expire_all()
    assert db_session_with_containers.get(Document, document_id) is None
    assert db_session_with_containers.get(DocumentSegment, segment_id) is not None
    assert db_session_with_containers.get(SegmentAttachmentBinding, binding_id) is not None
    intent = db_session_with_containers.scalar(
        select(KnowledgeTaskOutbox).where(
            KnowledgeTaskOutbox.task_kind == "document_cleanup",
            KnowledgeTaskOutbox.document_id == document_id,
        )
    )
    assert intent is not None
    assert intent.payload["doc_form"] == IndexStructureType.QA_INDEX
    assert intent.payload["file_id"] == committed_source.id
    manifest_payload = intent.payload["cleanup_manifest"]
    assert isinstance(manifest_payload, Mapping)
    manifest = DocumentCleanupManifest.from_payload(cast(Mapping[str, object], manifest_payload))
    assert [(file.id, file.key) for file in manifest.document_files] == [(committed_source.id, committed_source.key)]
    assert [(file.id, file.key) for file in manifest.image_files] == [(image.id, image.key)]
    assert [(item.binding_id, item.attachment_id, item.key) for item in manifest.segment_attachments] == [
        (binding_id, attachment.id, attachment.key)
    ]


def test_batch_delete_is_idempotent_and_persists_one_manifest(db_session_with_containers: Session) -> None:
    dataset = DocumentLifecycleFactory.create_dataset(db_session_with_containers)
    ref = DatasetRef(dataset.tenant_id, dataset.id)
    repository = _repository(db_session_with_containers)
    count_before = db_session_with_containers.scalar(select(func.count(KnowledgeTaskOutbox.id)))
    assert repository.delete_documents(ref, []) == 0
    assert db_session_with_containers.scalar(select(func.count(KnowledgeTaskOutbox.id))) == count_before

    uploads = [
        DocumentLifecycleFactory.create_upload_file(db_session_with_containers, dataset=dataset, name=name)
        for name in ("a.txt", "b.txt")
    ]
    documents = [
        DocumentLifecycleFactory.create_document(
            db_session_with_containers,
            dataset=dataset,
            position=position,
            data_source_info={"upload_file_id": upload.id},
        )
        for position, upload in enumerate(uploads, start=1)
    ]

    assert repository.delete_documents(ref, [document.id for document in documents]) == 2

    db_session_with_containers.expire_all()
    assert all(db_session_with_containers.get(Document, document.id) is None for document in documents)
    intent = db_session_with_containers.scalar(
        select(KnowledgeTaskOutbox).where(
            KnowledgeTaskOutbox.task_kind == "document_batch_cleanup",
            KnowledgeTaskOutbox.dataset_id == dataset.id,
        )
    )
    assert intent is not None
    document_ids_payload = intent.payload["document_ids"]
    assert isinstance(document_ids_payload, list)
    assert all(isinstance(document_id, str) for document_id in document_ids_payload)
    assert set(cast(list[str], document_ids_payload)) == {document.id for document in documents}
    manifest_payload = intent.payload["cleanup_manifest"]
    assert isinstance(manifest_payload, Mapping)
    manifest = DocumentCleanupManifest.from_payload(cast(Mapping[str, object], manifest_payload))
    assert {file.id for file in manifest.document_files} == {upload.id for upload in uploads}
