import uuid
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

import tasks.batch_clean_document_task as task_module
from models.dataset import Dataset, DocumentSegment
from models.enums import DataSourceType
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
