from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, DocumentSegment
from models.enums import CreatorUserRole, SegmentStatus
from models.model import UploadFile
from tasks.batch_clean_document_task import batch_clean_document_task


def _setup_cleanup_dependencies(*, index_node_id: str | None = "node-1"):
    session = MagicMock()
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="document-1",
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by="creator-1",
        index_node_id=index_node_id,
        status=SegmentStatus.COMPLETED,
        enabled=True,
    )
    segment.id = "segment-1"
    dataset = Dataset(
        tenant_id="tenant-1",
        name="Cleanup dataset",
        created_by="creator-1",
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
    )
    dataset.id = "dataset-1"
    session.scalars.return_value.all.return_value = [segment]
    session.scalar.return_value = dataset

    context_manager = MagicMock()
    context_manager.__enter__.return_value = session
    context_manager.__exit__.return_value = None
    return session, context_manager


def test_successful_vector_cleanup_schedules_billing_refresh():
    _, context_manager = _setup_cleanup_dependencies()

    with (
        patch("tasks.batch_clean_document_task.session_factory.create_session", return_value=context_manager),
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh") as schedule_refresh,
    ):
        batch_clean_document_task(
            document_ids=["document-1"],
            dataset_id="dataset-1",
            doc_form="paragraph",
            file_ids=[],
        )

    processor_factory.return_value.init_index_processor.return_value.clean.assert_called_once()
    schedule_refresh.assert_called_once_with("tenant-1")


def test_failed_vector_cleanup_does_not_schedule_billing_refresh():
    session, context_manager = _setup_cleanup_dependencies()

    with (
        patch("tasks.batch_clean_document_task.session_factory.create_session", return_value=context_manager),
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh") as schedule_refresh,
    ):
        processor_factory.return_value.init_index_processor.return_value.clean.side_effect = RuntimeError(
            "vector cleanup failed"
        )
        batch_clean_document_task(
            document_ids=["document-1"],
            dataset_id="dataset-1",
            doc_form="paragraph",
            file_ids=[],
        )

    assert any("DELETE FROM document_segment_summaries" in str(call.args[0]) for call in session.execute.call_args_list)
    assert any("DELETE FROM child_chunks" in str(call.args[0]) for call in session.execute.call_args_list)
    schedule_refresh.assert_not_called()


def test_segment_without_primary_node_id_still_runs_summary_cleanup():
    _, context_manager = _setup_cleanup_dependencies(index_node_id=None)

    with (
        patch("tasks.batch_clean_document_task.session_factory.create_session", return_value=context_manager),
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[]),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh"),
    ):
        batch_clean_document_task(
            document_ids=["document-1"],
            dataset_id="dataset-1",
            doc_form="paragraph",
            file_ids=[],
        )

    processor = processor_factory.return_value.init_index_processor.return_value
    processor.clean.assert_called_once()
    args, kwargs = processor.clean.call_args
    assert args[1] == []
    assert kwargs["segment_ids"] == ["segment-1"]
    assert kwargs["delete_summaries"] is True


def test_missing_dataset_is_a_scoped_noop():
    session = MagicMock()
    session.scalar.return_value = None
    context_manager = MagicMock()
    context_manager.__enter__.return_value = session

    with (
        patch("tasks.batch_clean_document_task.session_factory.create_session", return_value=context_manager),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory") as processor_factory,
    ):
        batch_clean_document_task(
            document_ids=["document-1"],
            dataset_id="missing-dataset",
            doc_form="paragraph",
            file_ids=[],
        )

    processor_factory.assert_not_called()
    session.scalars.assert_not_called()


def test_image_upload_rows_are_tenant_scoped_and_deleted():
    session, context_manager = _setup_cleanup_dependencies()
    image_file = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="image-key",
        name="image.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="creator-1",
        created_at=datetime.now(UTC).replace(tzinfo=None),
        used=True,
    )
    segment_result = MagicMock()
    segment_result.all.return_value = session.scalars.return_value.all.return_value
    image_result = MagicMock()
    image_result.all.return_value = [image_file]
    session.scalars.side_effect = [segment_result, image_result]

    with (
        patch("tasks.batch_clean_document_task.session_factory.create_session", return_value=context_manager),
        patch("tasks.batch_clean_document_task.get_image_upload_file_ids", return_value=[image_file.id]),
        patch("tasks.batch_clean_document_task.IndexProcessorFactory"),
        patch("tasks.batch_clean_document_task.storage") as storage,
        patch("tasks.batch_clean_document_task.schedule_billing_vector_space_refresh"),
    ):
        batch_clean_document_task(
            document_ids=["document-1"],
            dataset_id="dataset-1",
            doc_form="paragraph",
            file_ids=[],
        )

    executed_statements = [str(call.args[0]) for call in session.execute.call_args_list]
    assert any("DELETE FROM upload_files" in statement for statement in executed_statements)
    assert all(
        "upload_files.tenant_id" in statement for statement in executed_statements if "upload_files" in statement
    )
    storage.delete.assert_called_once_with(image_file.key)
