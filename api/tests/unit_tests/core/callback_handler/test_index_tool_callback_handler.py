import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.index_tool_callback_handler import (
    DatasetIndexToolCallbackHandler,
)


@pytest.fixture
def mock_queue_manager(mocker):
    return mocker.Mock()


@pytest.fixture
def handler(mock_queue_manager, mocker):
    mocker.patch(
        "core.callback_handler.index_tool_callback_handler.db",
    )
    return DatasetIndexToolCallbackHandler(
        queue_manager=mock_queue_manager,
        app_id="app-1",
        message_id="msg-1",
        user_id="user-1",
        invoke_from=mocker.Mock(),
    )


class TestOnQuery:
    @pytest.mark.parametrize(
        ("invoke_from", "expected_role"),
        [
            (InvokeFrom.EXPLORE, "account"),
            (InvokeFrom.DEBUGGER, "account"),
            (InvokeFrom.WEB_APP, "end_user"),
        ],
    )
    def test_on_query_success_roles(self, mocker, mock_queue_manager, invoke_from, expected_role):
        # Arrange
        mock_db = mocker.patch("core.callback_handler.index_tool_callback_handler.db")

        handler = DatasetIndexToolCallbackHandler(
            queue_manager=mock_queue_manager,
            app_id="app-1",
            message_id="msg-1",
            user_id="user-1",
            invoke_from=mocker.Mock(),
        )

        handler._invoke_from = invoke_from

        # Act
        handler.on_query("test query", "dataset-1")

        # Assert
        mock_db.session.add.assert_called_once()
        dataset_query = mock_db.session.add.call_args.args[0]
        assert dataset_query.created_by_role == expected_role
        mock_db.session.commit.assert_called_once()

    def test_on_query_none_values(self, mocker, mock_queue_manager):
        mock_db = mocker.patch("core.callback_handler.index_tool_callback_handler.db")

        handler = DatasetIndexToolCallbackHandler(
            queue_manager=mock_queue_manager,
            app_id=None,
            message_id=None,
            user_id=None,
            invoke_from=None,
        )

        handler.on_query(None, None)

        mock_db.session.add.assert_called_once()
        mock_db.session.commit.assert_called_once()


class TestOnToolEnd:
    def test_on_tool_end_no_metadata(self, handler, mocker):
        mock_db = mocker.patch("core.callback_handler.index_tool_callback_handler.db")

        document = mocker.Mock()
        document.metadata = None

        handler.on_tool_end([document])

        mock_db.session.commit.assert_not_called()

    def test_on_tool_end_dataset_document_not_found(self, handler, mocker):
        mock_db = mocker.patch("core.callback_handler.index_tool_callback_handler.db")
        mock_db.session.scalar.return_value = None

        document = mocker.Mock()
        document.metadata = {"document_id": "doc-1", "doc_id": "node-1"}

        handler.on_tool_end([document])

        mock_db.session.scalar.assert_called_once()

    def test_on_tool_end_parent_child_index_with_child(self, handler, mocker):
        mock_db = mocker.patch("core.callback_handler.index_tool_callback_handler.db")

        mock_dataset_doc = mocker.Mock()
        from core.callback_handler.index_tool_callback_handler import IndexStructureType

        mock_dataset_doc.doc_form = IndexStructureType.PARENT_CHILD_INDEX
        mock_dataset_doc.dataset_id = "dataset-1"
        mock_dataset_doc.id = "doc-1"

        mock_child_chunk = mocker.Mock()
        mock_child_chunk.segment_id = "segment-1"

        mock_db.session.scalar.side_effect = [mock_dataset_doc, mock_child_chunk]

        document = mocker.Mock()
        document.metadata = {"document_id": "doc-1", "doc_id": "node-1"}

        handler.on_tool_end([document])

        mock_db.session.execute.assert_called_once()
        mock_db.session.commit.assert_called_once()

    def test_on_tool_end_non_parent_child_index(self, handler, mocker):
        mock_db = mocker.patch("core.callback_handler.index_tool_callback_handler.db")

        mock_dataset_doc = mocker.Mock()
        mock_dataset_doc.doc_form = "OTHER"

        mock_db.session.scalar.return_value = mock_dataset_doc

        document = mocker.Mock()
        document.metadata = {
            "document_id": "doc-1",
            "doc_id": "node-1",
            "dataset_id": "dataset-1",
        }

        handler.on_tool_end([document])

        mock_db.session.execute.assert_called_once()
        mock_db.session.commit.assert_called_once()

    def test_on_tool_end_empty_documents(self, handler):
        handler.on_tool_end([])


class TestReturnRetrieverResourceInfo:
    def test_publish_called(self, handler, mock_queue_manager, mocker):
        mock_event = mocker.patch("core.callback_handler.index_tool_callback_handler.QueueRetrieverResourcesEvent")

        resources = [mocker.Mock()]

        handler.return_retriever_resource_info(resources)

        mock_queue_manager.publish.assert_called_once()
