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
        patch("tasks.batch_clean_document_task.clean_document_indexes", return_value=tenant_id) as index_cleanup,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh") as schedule_refresh,
    ):
        batch_clean_document_task(
            document_ids=[document_id],
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_ids=[],
        )

    index_cleanup.assert_called_once()
    schedule_refresh.assert_called_once_with(tenant_id)


def test_failed_vector_cleanup_does_not_schedule_billing_refresh(cleanup_rows: tuple[str, str, str]):
    dataset_id, document_id, _tenant_id = cleanup_rows

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.clean_document_indexes") as index_cleanup,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh") as schedule_refresh,
    ):
        index_cleanup.side_effect = RuntimeError("vector cleanup failed")
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
        patch("tasks.batch_clean_document_task.clean_document_indexes"),
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


def _make_attachment(*, tenant_id: str, created_by: str, key: str) -> UploadFile:
    return UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=key,
        name=key.rsplit("/", maxsplit=1)[-1],
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=created_by,
        created_at=datetime.now(UTC),
        used=True,
    )


def test_cleans_orphan_attachment_vectors(cleanup_rows: tuple[str, str, str], sqlite_session: Session) -> None:
    """孤儿附件的向量只能靠 extra_node_ids 送进索引清理。"""
    dataset_id, document_id, tenant_id = cleanup_rows
    segment = sqlite_session.query(DocumentSegment).filter_by(document_id=document_id).one()
    attachment = _make_attachment(tenant_id=tenant_id, created_by=segment.created_by, key="attachments/orphan.png")
    sqlite_session.add(attachment)
    sqlite_session.flush()
    sqlite_session.add(
        SegmentAttachmentBinding(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            segment_id=segment.id,
            attachment_id=attachment.id,
        )
    )
    sqlite_session.commit()
    attachment_id = attachment.id

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.clean_document_indexes", return_value=tenant_id) as index_cleanup,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh"),
        patch("tasks.batch_clean_document_task.storage.delete"),
    ):
        batch_clean_document_task(
            document_ids=[document_id],
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_ids=[],
        )

    _, kwargs = index_cleanup.call_args
    assert kwargs["extra_node_ids"] == [attachment_id]


def test_attachment_bound_to_another_document_survives(
    cleanup_rows: tuple[str, str, str], sqlite_session: Session
) -> None:
    """本批之外还有文档绑定它时，附件行、blob 与向量都必须留下。"""
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
        index_node_id="node-other",
    )
    attachment = _make_attachment(tenant_id=tenant_id, created_by=segment.created_by, key="attachments/shared.png")
    sqlite_session.add_all([other_segment, attachment])
    sqlite_session.flush()
    binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_id=segment.id,
        attachment_id=attachment.id,
    )
    other_binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=other_document_id,
        segment_id=other_segment.id,
        attachment_id=attachment.id,
    )
    sqlite_session.add_all([binding, other_binding])
    sqlite_session.commit()
    attachment_id = attachment.id
    binding_id = binding.id
    other_binding_id = other_binding.id

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.clean_document_indexes", return_value=tenant_id) as index_cleanup,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh"),
        patch("tasks.batch_clean_document_task.storage.delete") as storage_delete,
    ):
        batch_clean_document_task(
            document_ids=[document_id],
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_ids=[],
        )

    _, kwargs = index_cleanup.call_args
    assert kwargs["extra_node_ids"] == []

    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(SegmentAttachmentBinding, other_binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None
    for call in storage_delete.call_args_list:
        assert call.args[0] != "attachments/shared.png"


def test_documents_without_segments_skip_attachment_release(cleanup_rows: tuple[str, str, str]) -> None:
    """没有分段时不应进入附件释放步骤，extra_node_ids 为空。"""
    dataset_id, _document_id, tenant_id = cleanup_rows
    empty_document_id = str(uuid.uuid4())

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.clean_document_indexes", return_value=tenant_id) as index_cleanup,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh"),
        patch("tasks.batch_clean_document_task.storage.delete") as storage_delete,
    ):
        batch_clean_document_task(
            document_ids=[empty_document_id],
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_ids=[],
        )

    _, kwargs = index_cleanup.call_args
    assert kwargs["extra_node_ids"] == []
    storage_delete.assert_not_called()


def test_attachment_release_failure_does_not_abort_storage_cleanup(
    cleanup_rows: tuple[str, str, str],
    sqlite_session: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """附件释放那一步失败，后续的存储清理仍然要跑完。"""
    dataset_id, document_id, tenant_id = cleanup_rows
    segment = sqlite_session.query(DocumentSegment).filter_by(document_id=document_id).one()
    attachment = _make_attachment(tenant_id=tenant_id, created_by=segment.created_by, key="attachments/orphan.png")
    sqlite_session.add(attachment)
    sqlite_session.flush()
    sqlite_session.add(
        SegmentAttachmentBinding(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            segment_id=segment.id,
            attachment_id=attachment.id,
        )
    )
    sqlite_session.commit()

    engine = sqlite_session.get_bind()
    calls = {"n": 0}

    def flaky_session() -> Session:
        calls["n"] += 1
        # 第 3 次是 Step 3.5 的附件释放事务（1=Step 1 读，2=Step 3 元数据）。
        if calls["n"] == 3:
            raise RuntimeError("attachment release failed")
        return Session(engine, expire_on_commit=False)

    with (
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.clean_document_indexes", return_value=tenant_id),
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh"),
        patch("tasks.batch_clean_document_task.storage.delete") as storage_delete,
        patch.object(task_module.session_factory, "create_session", flaky_session),
        caplog.at_level("ERROR"),
    ):
        batch_clean_document_task(
            document_ids=[document_id],
            dataset_id=dataset_id,
            doc_form="paragraph",
            file_ids=[],
        )

    # 断言异常分支确实被走到，避免测试空过。
    assert "Failed to release segment attachments" in caplog.text
    storage_delete.assert_any_call("attachments/orphan.png")
