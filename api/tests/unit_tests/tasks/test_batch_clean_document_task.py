import logging
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


def _attachment(*, tenant_id: str, created_by: str, key: str) -> UploadFile:
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


def test_cleans_orphan_attachment_vectors(cleanup_rows: tuple[str, str, str], sqlite_session: Session):
    """Attachment vectors live under doc_id == UploadFile.id, so they need their own clean call."""
    dataset_id, document_id, tenant_id = cleanup_rows
    segment = sqlite_session.query(DocumentSegment).filter_by(document_id=document_id).one()
    attachment = _attachment(tenant_id=tenant_id, created_by=segment.created_by, key="attachments/orphan.png")
    sqlite_session.add_all(
        [
            attachment,
            SegmentAttachmentBinding(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
                segment_id=segment.id,
                attachment_id=attachment.id,
            ),
        ]
    )
    sqlite_session.commit()
    attachment_id = attachment.id

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory") as factory_cls,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh"),
        patch("tasks.batch_clean_document_task.storage.delete"),
    ):
        processor = factory_cls.return_value.init_index_processor.return_value
        batch_clean_document_task(
            document_ids=[document_id],
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_ids=[],
        )

    cleaned_node_ids: set[str] = set()
    for call in processor.clean.call_args_list:
        cleaned_node_ids.update(call.args[1])
    assert attachment_id in cleaned_node_ids


def test_attachment_bound_to_another_document_survives(cleanup_rows: tuple[str, str, str], sqlite_session: Session):
    """A batch delete must not destroy an attachment a document outside the batch still binds."""
    dataset_id, document_id, tenant_id = cleanup_rows
    segment = sqlite_session.query(DocumentSegment).filter_by(document_id=document_id).one()
    other_document_id = str(uuid.uuid4())
    other_segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=other_document_id,
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by=segment.created_by,
        index_node_id="node-2",
    )
    attachment = _attachment(tenant_id=tenant_id, created_by=segment.created_by, key="attachments/shared.png")
    sqlite_session.add_all([other_segment, attachment])
    sqlite_session.flush()
    sqlite_session.add_all(
        [
            SegmentAttachmentBinding(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
                segment_id=segment.id,
                attachment_id=attachment.id,
            ),
            SegmentAttachmentBinding(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=other_document_id,
                segment_id=other_segment.id,
                attachment_id=attachment.id,
            ),
        ]
    )
    sqlite_session.commit()
    attachment_id = attachment.id
    attachment_key = attachment.key

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory") as factory_cls,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh"),
        patch("tasks.batch_clean_document_task.storage.delete") as storage_delete,
    ):
        processor = factory_cls.return_value.init_index_processor.return_value
        batch_clean_document_task(
            document_ids=[document_id],
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_ids=[],
        )

    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, attachment_id) is not None
    assert attachment_key not in {call.args[0] for call in storage_delete.call_args_list}
    cleaned_node_ids: set[str] = set()
    for call in processor.clean.call_args_list:
        cleaned_node_ids.update(call.args[1])
    assert attachment_id not in cleaned_node_ids


def test_documents_without_segments_skip_attachment_release(cleanup_rows: tuple[str, str, str]):
    """A batch whose documents have no segments has nothing to release."""
    dataset_id, _document_id, _tenant_id = cleanup_rows
    empty_document_id = str(uuid.uuid4())

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory") as factory_cls,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh"),
        patch("tasks.batch_clean_document_task.storage.delete") as storage_delete,
    ):
        batch_clean_document_task(
            document_ids=[empty_document_id],
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_ids=[],
        )

    factory_cls.return_value.init_index_processor.return_value.clean.assert_not_called()
    storage_delete.assert_not_called()


def test_attachment_release_failure_does_not_abort_storage_cleanup(
    cleanup_rows: tuple[str, str, str],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    """A failure while releasing attachments still leaves the remaining steps to run."""
    dataset_id, document_id, tenant_id = cleanup_rows
    segment = sqlite_session.query(DocumentSegment).filter_by(document_id=document_id).one()
    attachment = _attachment(tenant_id=tenant_id, created_by=segment.created_by, key="attachments/boom.png")
    sqlite_session.add_all(
        [
            attachment,
            SegmentAttachmentBinding(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
                segment_id=segment.id,
                attachment_id=attachment.id,
            ),
        ]
    )
    sqlite_session.commit()
    attachment_key = attachment.key

    engine = sqlite_session.get_bind()
    calls = {"n": 0}
    # Step 1, Step 2 (vector), Step 3 (metadata), then Step 3.5 (attachment release).
    failing_call = 4

    def _create_session():
        calls["n"] += 1
        if calls["n"] == failing_call:
            raise RuntimeError("attachment release boom")
        return Session(engine, expire_on_commit=False)

    monkeypatch.setattr(task_module.session_factory, "create_session", _create_session)

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory"),
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh"),
        patch("tasks.batch_clean_document_task.storage.delete") as storage_delete,
    ):
        with caplog.at_level(logging.ERROR):
            batch_clean_document_task(
                document_ids=[document_id],
                dataset_id=dataset_id,
                doc_form="paragraph",
                file_ids=[],
            )

    assert "Failed to release segment attachments" in caplog.text
    # The orphan's storage key was collected in Step 1, so Step 7 still runs for it.
    assert attachment_key in {call.args[0] for call in storage_delete.call_args_list}
