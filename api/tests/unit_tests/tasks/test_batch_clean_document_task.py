import uuid
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

import tasks.batch_clean_document_task as task_module
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, DocumentSegment, SegmentAttachmentBinding
from models.enums import CreatorUserRole, DataSourceType
from models.model import UploadFile
from tasks.batch_clean_document_task import batch_clean_document_task


@pytest.fixture
def cleanup_rows(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> tuple[str, str, str]:
    tenant_id = str(uuid.uuid4())
    dataset_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())
    created_by = str(uuid.uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Batch cleanup dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
    )
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by=created_by,
        index_node_id="node-1",
    )
    sqlite_session.add_all([dataset, segment])
    sqlite_session.commit()
    engine = sqlite_session.get_bind()
    monkeypatch.setattr(
        task_module.session_factory,
        "create_session",
        lambda: Session(engine, expire_on_commit=False),
    )
    return dataset_id, document_id, tenant_id


def test_successful_vector_cleanup_schedules_billing_refresh(cleanup_rows: tuple[str, str, str]):
    dataset_id, document_id, tenant_id = cleanup_rows

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh") as schedule_refresh,
    ):
        batch_clean_document_task(
            document_ids=[document_id],
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_ids=[],
        )

    processor_factory.return_value.init_index_processor.return_value.clean.assert_called_once()
    schedule_refresh.assert_called_once_with(tenant_id)


def test_failed_vector_cleanup_does_not_schedule_billing_refresh(cleanup_rows: tuple[str, str, str]):
    dataset_id, document_id, _tenant_id = cleanup_rows

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh") as schedule_refresh,
    ):
        processor_factory.return_value.init_index_processor.return_value.clean.side_effect = RuntimeError(
            "vector cleanup failed"
        )
        batch_clean_document_task(
            document_ids=[document_id],
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_ids=[],
        )

    schedule_refresh.assert_not_called()


def test_cleans_segment_attachment_bindings_and_files(cleanup_rows: tuple[str, str, str], sqlite_session: Session):
    dataset_id, document_id, tenant_id = cleanup_rows
    segment = sqlite_session.query(DocumentSegment).filter_by(document_id=document_id).one()
    attachment = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="attachments/image.png",
        name="image.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=segment.created_by,
        created_at=datetime.now(UTC),
        used=True,
    )
    binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_id=segment.id,
        attachment_id=attachment.id,
    )
    sqlite_session.add_all([attachment, binding])
    sqlite_session.commit()
    attachment_id = attachment.id
    attachment_key = attachment.key
    binding_id = binding.id

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory"),
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh"),
        patch("tasks.batch_clean_document_task.storage.delete") as storage_delete,
    ):
        batch_clean_document_task(
            document_ids=[document_id],
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_ids=[],
        )

    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None
    storage_delete.assert_called_once_with(attachment_key)
