import pytest
from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.index_tool_callback_handler import (
    DatasetIndexToolCallbackHandler,
)


@pytest.fixture
def mock_queue_manager(mocker: MockerFixture):
    return mocker.Mock()


@pytest.fixture
def handler(mock_queue_manager, mocker: MockerFixture):
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
    def test_on_query_success_roles(self, mocker: MockerFixture, mock_queue_manager, invoke_from, expected_role):
        # Arrange — the caller passes a session, but our fix uses an independent one
        caller_session = mocker.Mock()

        independent_session = mocker.MagicMock()
        mock_session_factory = mocker.MagicMock()
        mock_session_factory.begin.return_value.__enter__ = mocker.MagicMock(return_value=independent_session)
        mock_session_factory.begin.return_value.__exit__ = mocker.MagicMock(return_value=False)
        mocker.patch(
            "core.callback_handler.index_tool_callback_handler.sessionmaker",
            return_value=mock_session_factory,
        )
        mocker.patch("core.callback_handler.index_tool_callback_handler.db")

        handler = DatasetIndexToolCallbackHandler(
            queue_manager=mock_queue_manager,
            app_id="app-1",
            message_id="msg-1",
            user_id="user-1",
            invoke_from=mocker.Mock(),
        )

        handler._invoke_from = invoke_from

        # Act — pass caller_session as required by signature
        handler.on_query("test query", "dataset-1", caller_session)

        # Assert — independent session used, not the caller's session
        independent_session.add.assert_called_once()
        dataset_query = independent_session.add.call_args.args[0]
        assert dataset_query.created_by_role == expected_role
        caller_session.add.assert_not_called()
        caller_session.commit.assert_not_called()

    def test_on_query_none_values(self, mocker: MockerFixture, mock_queue_manager):
        caller_session = mocker.Mock()

        independent_session = mocker.MagicMock()
        mock_session_factory = mocker.MagicMock()
        mock_session_factory.begin.return_value.__enter__ = mocker.MagicMock(return_value=independent_session)
        mock_session_factory.begin.return_value.__exit__ = mocker.MagicMock(return_value=False)
        mocker.patch(
            "core.callback_handler.index_tool_callback_handler.sessionmaker",
            return_value=mock_session_factory,
        )
        mocker.patch("core.callback_handler.index_tool_callback_handler.db")

        handler = DatasetIndexToolCallbackHandler(
            queue_manager=mock_queue_manager,
            app_id=None,
            message_id=None,
            user_id=None,
            invoke_from=None,
        )

        handler.on_query(None, None, caller_session)

        independent_session.add.assert_called_once()
        caller_session.add.assert_not_called()


class TestOnToolEnd:
    def test_on_tool_end_no_metadata(self, handler: DatasetIndexToolCallbackHandler, mocker: MockerFixture):
        caller_session = mocker.Mock()

        independent_session = mocker.MagicMock()
        mocker.patch(
            "core.callback_handler.index_tool_callback_handler.Session",
            return_value=independent_session,
        )
        independent_session.__enter__ = mocker.MagicMock(return_value=independent_session)
        independent_session.__exit__ = mocker.MagicMock(return_value=False)

        document = mocker.Mock()
        document.metadata = None

        handler.on_tool_end([document], caller_session)

        independent_session.commit.assert_called_once()
        independent_session.execute.assert_not_called()
        caller_session.commit.assert_not_called()

    def test_on_tool_end_dataset_document_not_found(
        self, handler: DatasetIndexToolCallbackHandler, mocker: MockerFixture
    ):
        caller_session = mocker.Mock()

        independent_session = mocker.MagicMock()
        mocker.patch(
            "core.callback_handler.index_tool_callback_handler.Session",
            return_value=independent_session,
        )
        independent_session.__enter__ = mocker.MagicMock(return_value=independent_session)
        independent_session.__exit__ = mocker.MagicMock(return_value=False)
        independent_session.scalar.return_value = None

        document = mocker.Mock()
        document.metadata = {"document_id": "doc-1", "doc_id": "node-1"}

        handler.on_tool_end([document], caller_session)

        independent_session.scalar.assert_called_once()
        caller_session.scalar.assert_not_called()

    def test_on_tool_end_parent_child_index_with_child(
        self, handler: DatasetIndexToolCallbackHandler, mocker: MockerFixture
    ):
        caller_session = mocker.Mock()

        independent_session = mocker.MagicMock()
        mocker.patch(
            "core.callback_handler.index_tool_callback_handler.Session",
            return_value=independent_session,
        )
        independent_session.__enter__ = mocker.MagicMock(return_value=independent_session)
        independent_session.__exit__ = mocker.MagicMock(return_value=False)

        mock_dataset_doc = mocker.Mock()
        from core.callback_handler.index_tool_callback_handler import IndexStructureType

        mock_dataset_doc.doc_form = IndexStructureType.PARENT_CHILD_INDEX
        mock_dataset_doc.dataset_id = "dataset-1"
        mock_dataset_doc.id = "doc-1"

        mock_child_chunk = mocker.Mock()
        mock_child_chunk.segment_id = "segment-1"

        independent_session.scalar.side_effect = [mock_dataset_doc, mock_child_chunk]

        document = mocker.Mock()
        document.metadata = {"document_id": "doc-1", "doc_id": "node-1"}

        handler.on_tool_end([document], caller_session)

        independent_session.execute.assert_called_once()
        independent_session.commit.assert_called_once()
        caller_session.execute.assert_not_called()

    def test_on_tool_end_non_parent_child_index(
        self, handler: DatasetIndexToolCallbackHandler, mocker: MockerFixture
    ):
        caller_session = mocker.Mock()

        independent_session = mocker.MagicMock()
        mocker.patch(
            "core.callback_handler.index_tool_callback_handler.Session",
            return_value=independent_session,
        )
        independent_session.__enter__ = mocker.MagicMock(return_value=independent_session)
        independent_session.__exit__ = mocker.MagicMock(return_value=False)

        mock_dataset_doc = mocker.Mock()
        mock_dataset_doc.doc_form = "OTHER"

        independent_session.scalar.return_value = mock_dataset_doc

        document = mocker.Mock()
        document.metadata = {
            "document_id": "doc-1",
            "doc_id": "node-1",
            "dataset_id": "dataset-1",
        }

        handler.on_tool_end([document], caller_session)

        independent_session.execute.assert_called_once()
        independent_session.commit.assert_called_once()
        caller_session.execute.assert_not_called()

    def test_on_tool_end_empty_documents(self, handler: DatasetIndexToolCallbackHandler, mocker: MockerFixture):
        caller_session = mocker.Mock()

        independent_session = mocker.MagicMock()
        mocker.patch(
            "core.callback_handler.index_tool_callback_handler.Session",
            return_value=independent_session,
        )
        independent_session.__enter__ = mocker.MagicMock(return_value=independent_session)
        independent_session.__exit__ = mocker.MagicMock(return_value=False)

        handler.on_tool_end([], caller_session)


class TestReturnRetrieverResourceInfo:
    def test_publish_called(self, handler: DatasetIndexToolCallbackHandler, mock_queue_manager, mocker: MockerFixture):
        mock_event = mocker.patch("core.callback_handler.index_tool_callback_handler.QueueRetrieverResourcesEvent")

        resources = [mocker.Mock()]

        handler.return_retriever_resource_info(resources)

        mock_queue_manager.publish.assert_called_once()
