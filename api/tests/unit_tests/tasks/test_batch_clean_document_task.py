from unittest.mock import MagicMock, patch

from tasks.batch_clean_document_task import batch_clean_document_task


def _setup_cleanup_dependencies():
    session = MagicMock()
    segment = MagicMock(id="segment-1", index_node_id="node-1", content="content")
    dataset = MagicMock(id="dataset-1", tenant_id="tenant-1")
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
    _, context_manager = _setup_cleanup_dependencies()

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

    schedule_refresh.assert_not_called()
