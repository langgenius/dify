import uuid
from collections.abc import Generator
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.db.session_factory import configure_session_factory
from core.rag.index_processor.constant.index_type import IndexStructureType
from extensions.storage.storage_type import StorageType
from models.base import Base
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.model import UploadFile
from tasks.delete_segment_from_index_task import delete_segment_from_index_task


@pytest.fixture
def sqlite_session_factory(_unit_test_engine) -> Generator[sessionmaker[Session], None, None]:
    tables = [
        Dataset.__table__,
        Document.__table__,
        DocumentSegment.__table__,
        UploadFile.__table__,
        SegmentAttachmentBinding.__table__,
    ]
    Base.metadata.create_all(_unit_test_engine, tables=tables)
    factory = sessionmaker(bind=_unit_test_engine, expire_on_commit=False)
    configure_session_factory(_unit_test_engine, expire_on_commit=False)
    try:
        yield factory
    finally:
        Base.metadata.drop_all(_unit_test_engine, tables=reversed(tables))


@pytest.fixture
def sqlite_session(sqlite_session_factory: sessionmaker[Session]) -> Generator[Session, None, None]:
    with sqlite_session_factory() as session:
        yield session


@pytest.fixture
def indexed_segment(sqlite_session: Session) -> tuple[Dataset, Document, DocumentSegment]:
    tenant_id = str(uuid.uuid4())
    created_by = str(uuid.uuid4())
    dataset = Dataset(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Cleanup dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
        is_multimodal=True,
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


def _create_attachment(dataset: Dataset, segment: DocumentSegment, key: str) -> UploadFile:
    return UploadFile(
        tenant_id=dataset.tenant_id,
        storage_type=StorageType.LOCAL,
        key=key,
        name=key.rsplit("/", 1)[-1],
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=segment.created_by,
        created_at=datetime.now(UTC),
        used=True,
    )


def _create_binding(
    dataset: Dataset, document: Document, segment: DocumentSegment, attachment: UploadFile
) -> SegmentAttachmentBinding:
    return SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id=segment.id,
        attachment_id=attachment.id,
    )


def test_delete_segment_removes_attachment_blob_from_storage(
    indexed_segment: tuple[Dataset, Document, DocumentSegment], sqlite_session: Session
) -> None:
    dataset, document, segment = indexed_segment
    attachment = _create_attachment(dataset, segment, "attachments/segment-image.png")
    binding = _create_binding(dataset, document, segment, attachment)
    sqlite_session.add_all([attachment, binding])
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
    assert processor.clean.call_count == 2
    storage_delete.assert_called_once_with(attachment_key)
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None


def test_delete_segment_preserves_attachment_shared_by_another_segment(
    indexed_segment: tuple[Dataset, Document, DocumentSegment], sqlite_session: Session
) -> None:
    dataset, document, segment = indexed_segment
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
        status=SegmentStatus.COMPLETED,
    )
    attachment = _create_attachment(dataset, segment, "attachments/shared-segment-image.png")
    sqlite_session.add_all([other_segment, attachment])
    sqlite_session.flush()
    binding = _create_binding(dataset, document, segment, attachment)
    shared_binding = _create_binding(dataset, document, other_segment, attachment)
    sqlite_session.add_all([binding, shared_binding])
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
    storage_delete.assert_not_called()
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(SegmentAttachmentBinding, shared_binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None


def test_delete_segment_keeps_database_cleanup_when_storage_delete_fails(
    indexed_segment: tuple[Dataset, Document, DocumentSegment],
    sqlite_session: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dataset, document, segment = indexed_segment
    attachment = _create_attachment(dataset, segment, "attachments/failing-segment-image.png")
    binding = _create_binding(dataset, document, segment, attachment)
    sqlite_session.add_all([attachment, binding])
    sqlite_session.commit()
    attachment_id = attachment.id
    attachment_key = attachment.key
    binding_id = binding.id

    with (
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory"),
        patch(
            "tasks.delete_segment_from_index_task.storage.delete", side_effect=RuntimeError("storage unavailable")
        ) as storage_delete,
        caplog.at_level("ERROR", logger="tasks.delete_segment_from_index_task"),
    ):
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, [segment.id])

    storage_delete.assert_called_once_with(attachment_key)
    assert "Failed to delete segment attachment from storage" in caplog.text
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None
