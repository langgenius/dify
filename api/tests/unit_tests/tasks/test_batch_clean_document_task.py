import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

import tasks.batch_clean_document_task as task_module
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, DocumentSegment
from models.enums import CreatorUserRole, DataSourceType
from models.knowledge_fs import KnowledgeFSUpgradeFileLease, KnowledgeFSUpgradeJob
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


def test_batch_cleanup_keeps_only_the_leased_legacy_source_file(
    cleanup_rows: tuple[str, str, str], sqlite_session: Session
) -> None:
    dataset_id, document_id, tenant_id = cleanup_rows
    account_id = str(uuid.uuid4())
    now = datetime.now(UTC).replace(tzinfo=None)
    leased_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"upload_files/{tenant_id}/leased.txt",
        name="leased.txt",
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account_id,
        created_at=now,
        used=False,
    )
    deletable_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"upload_files/{tenant_id}/deletable.txt",
        name="deletable.txt",
        size=10,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account_id,
        created_at=now,
        used=False,
    )
    job = KnowledgeFSUpgradeJob(
        tenant_id=tenant_id,
        old_dataset_id=dataset_id,
        requested_by_account_id=account_id,
        owner_account_id=account_id,
        idempotency_key="batch-cleanup-lease-test",
        snapshot_at=now,
        config_snapshot={},
        permission_snapshot={},
        app_binding_snapshot=[],
        tag_ids_snapshot=[],
    )
    sqlite_session.add_all([leased_file, deletable_file, job])
    sqlite_session.flush()
    sqlite_session.add(
        KnowledgeFSUpgradeFileLease(
            job_id=job.id,
            old_upload_file_id=leased_file.id,
            expires_at=now + timedelta(hours=1),
        )
    )
    sqlite_session.commit()
    leased_file_id = leased_file.id
    deletable_file_id = deletable_file.id
    deletable_file_key = deletable_file.key

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory"),
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh"),
        patch("tasks.batch_clean_document_task.storage") as storage,
    ):
        batch_clean_document_task(
            document_ids=[document_id],
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_ids=[leased_file_id, deletable_file_id],
        )

    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, leased_file_id) is not None
    assert sqlite_session.get(UploadFile, deletable_file_id) is None
    storage.delete.assert_called_once_with(deletable_file_key)
