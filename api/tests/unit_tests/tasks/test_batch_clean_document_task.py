"""Batch document cleanup delegates to the durable cleanup owner."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

import tasks.clean_document_task as cleanup_module
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import CreatorUserRole, DataSourceType
from models.model import UploadFile
from repositories.knowledge.upload_file_repository import build_document_cleanup_manifest
from tasks.batch_clean_document_task import batch_clean_document_task
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_document

SQLITE_MODELS = (Dataset, Document, DocumentSegment, SegmentAttachmentBinding, UploadFile)
pytestmark = pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)


@pytest.fixture(autouse=True)
def _enable_physical_cleanup(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=True)


@dataclass
class RecordingStorage:
    deleted_keys: list[str] = field(default_factory=list)

    def delete(self, key: str) -> None:
        self.deleted_keys.append(key)


def test_batch_cleanup_deletes_each_orphan_attachment_once(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    created_by = str(uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Batch dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
    )
    documents = [
        make_document(
            document_id=str(uuid4()),
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            name=f"document-{position}.txt",
            created_by=created_by,
            position=position,
        )
        for position in (1, 2)
    ]
    segments = [
        DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document.id,
            position=1,
            content="content",
            word_count=1,
            tokens=1,
            created_by=created_by,
            index_node_id=f"node-{document.id}",
        )
        for document in documents
    ]
    attachment = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/batch.png",
        name="batch.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=created_by,
        created_at=datetime.now(UTC),
        used=True,
    )
    bindings = [
        SegmentAttachmentBinding(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document.id,
            segment_id=segment.id,
            attachment_id=attachment.id,
        )
        for document, segment in zip(documents, segments, strict=True)
    ]
    sqlite_session.add_all([dataset, *documents, *segments, attachment, *bindings])
    sqlite_session.commit()
    document_ids = [document.id for document in documents]
    manifest = build_document_cleanup_manifest(
        sqlite_session,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=document_ids,
        document_file_ids=(),
    )
    attachment_id = attachment.id
    binding_ids = [binding.id for binding in bindings]
    for document in documents:
        sqlite_session.delete(document)
    sqlite_session.commit()

    engine = sqlite_session.get_bind()
    monkeypatch.setattr(
        cleanup_module.session_factory,
        "create_session",
        lambda: Session(engine, expire_on_commit=False),
    )
    recorder = RecordingStorage()
    monkeypatch.setattr(cleanup_module, "storage", recorder)

    batch_clean_document_task(
        document_ids,
        dataset_id,
        "text_model",
        [],
        tenant_id,
        manifest.to_payload(),
    )

    sqlite_session.expire_all()
    assert all(sqlite_session.get(SegmentAttachmentBinding, binding_id) is None for binding_id in binding_ids)
    assert sqlite_session.get(UploadFile, attachment_id) is None
    assert recorder.deleted_keys == ["attachments/batch.png"]
