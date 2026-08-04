from unittest.mock import MagicMock, patch

from tasks.retry_document_indexing_task import retry_document_indexing_task


def test_retry_enforces_vector_space_admission() -> None:
    session = MagicMock()
    dataset = MagicMock(id="dataset-1", tenant_id="tenant-1", runtime_mode="general")
    user = MagicMock(id="user-1")
    tenant = MagicMock(id="tenant-1")
    document = MagicMock(id="document-1", dataset_id="dataset-1", doc_form="paragraph")
    session.scalar.side_effect = [dataset, user, tenant, document]
    empty_segments: list[MagicMock] = []
    session.scalars.return_value.all.return_value = empty_segments

    session_context = MagicMock()
    session_context.__enter__.return_value = session
    features = MagicMock()
    features.billing.enabled = False

    with (
        patch(
            "tasks.retry_document_indexing_task.session_factory.create_session",
            return_value=session_context,
        ),
        patch("tasks.retry_document_indexing_task.FeatureService.get_features", return_value=features),
        patch("tasks.retry_document_indexing_task.IndexProcessorFactory"),
        patch("tasks.retry_document_indexing_task.IndexingRunner") as indexing_runner,
        patch("tasks.retry_document_indexing_task.redis_client"),
    ):
        retry_document_indexing_task.run(dataset.id, [document.id], user.id)

    indexing_runner.assert_called_once_with(enforce_vector_space_admission=True)
    indexing_runner.return_value.run.assert_called_once_with([document], session)
