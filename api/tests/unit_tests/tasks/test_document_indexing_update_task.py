from unittest.mock import MagicMock, patch

from tasks.document_indexing_update_task import document_indexing_update_task


@patch("tasks.document_indexing_update_task.IndexingRunner")
@patch("tasks.document_indexing_update_task.IndexProcessorFactory")
@patch("tasks.document_indexing_update_task.session_factory")
def test_commit_parsing_state_before_indexing_runner(
    mock_session_factory, mock_index_processor_factory, mock_runner_class
):
    mock_session = MagicMock()
    mock_context_manager = MagicMock()
    mock_context_manager.__enter__.return_value = mock_session
    mock_context_manager.__exit__.return_value = None
    mock_session_factory.create_session.return_value = mock_context_manager

    mock_document = MagicMock()
    mock_document.id = "doc-1"
    mock_document.doc_form = "text_model"
    mock_dataset = MagicMock()
    mock_dataset.id = "dataset-1"

    document_query = MagicMock()
    document_query.where.return_value.first.return_value = mock_document
    dataset_query = MagicMock()
    dataset_query.where.return_value.first.return_value = mock_dataset
    mock_session.query.side_effect = [document_query, dataset_query]
    mock_session.scalars.return_value.all.return_value = []

    execution_order: list[str] = []
    mock_session.commit.side_effect = lambda: execution_order.append("commit")

    runner = MagicMock()
    runner.run.side_effect = lambda _: execution_order.append("run")
    mock_runner_class.return_value = runner

    document_indexing_update_task("dataset-1", "doc-1")

    assert "commit" in execution_order
    assert "run" in execution_order
    assert execution_order.index("commit") < execution_order.index("run")
    runner.run.assert_called_once_with([mock_document])
    mock_index_processor_factory.return_value.init_index_processor.return_value.clean.assert_not_called()
