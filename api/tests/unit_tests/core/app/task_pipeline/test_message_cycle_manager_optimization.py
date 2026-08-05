"""Unit tests for the message cycle manager optimization."""

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from flask import Flask, current_app
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.queue_entities import QueueAnnotationReplyEvent, QueueRetrieverResourcesEvent
from core.app.entities.task_entities import MessageStreamResponse, StreamEvent, TaskStateMetadata
from core.app.task_pipeline import message_cycle_manager as message_cycle_manager_module
from core.app.task_pipeline.message_cycle_manager import MessageCycleManager
from core.rag.entities import RetrievalSourceMetadata
from graphon.file import FileTransferMethod, FileType
from models import model as model_module
from models.base import TypeBase
from models.enums import ConversationFromSource, CreatorUserRole, MessageFileBelongsTo
from models.model import App, AppMode, Conversation, MessageFile


@dataclass(frozen=True)
class _SQLiteDb:
    engine: Engine
    session: Session


@pytest.fixture
def cycle_db(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Session]:
    """Bind request-owned and cycle-manager-owned sessions to isolated SQLite."""
    TypeBase.metadata.create_all(
        sqlite_engine,
        tables=[App.__table__, Conversation.__table__, MessageFile.__table__],
    )
    owned_session_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with owned_session_factory() as request_session:
        sqlite_db = _SQLiteDb(engine=sqlite_engine, session=request_session)
        monkeypatch.setattr(message_cycle_manager_module, "db", sqlite_db)
        monkeypatch.setattr(model_module, "db", sqlite_db)
        monkeypatch.setattr(message_cycle_manager_module.session_factory, "create_session", owned_session_factory)
        yield request_session


def _app(*, app_id: str = "app-id", tenant_id: str = "tenant-1") -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name="Test App",
        description="",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )


def _conversation(*, conversation_id: str = "conv-1", app_id: str = "app-id") -> Conversation:
    conversation = Conversation(
        app_id=app_id,
        mode=AppMode.CHAT,
        name="",
        status="normal",
        from_source=ConversationFromSource.API,
        inputs={},
    )
    conversation.id = conversation_id
    return conversation


def _message_file(
    *,
    file_id: str = "file-1",
    message_id: str = "test-message-id",
    belongs_to: MessageFileBelongsTo | None = MessageFileBelongsTo.ASSISTANT,
    url: str | None = "http://example.com/image.png",
    file_type: FileType = FileType.IMAGE,
) -> MessageFile:
    message_file = MessageFile(
        message_id=message_id,
        type=file_type,
        transfer_method=FileTransferMethod.TOOL_FILE,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-id",
        belongs_to=belongs_to,
        url=url,
    )
    message_file.id = file_id
    return message_file


class TestMessageCycleManagerOptimization:
    """Test cases for the message cycle manager optimization that prevents N+1 queries."""

    @pytest.fixture
    def mock_application_generate_entity(self):
        """Create a mock application generate entity."""
        entity = Mock()
        entity.task_id = "test-task-id"
        return entity

    @pytest.fixture
    def message_cycle_manager(self, mock_application_generate_entity):
        """Create a message cycle manager instance."""
        task_state = Mock()
        return MessageCycleManager(application_generate_entity=mock_application_generate_entity, task_state=task_state)

    def test_get_message_event_type_with_assistant_file(self, message_cycle_manager, cycle_db: Session):
        """Test get_message_event_type returns MESSAGE_FILE when message has assistant-generated files.

        This ensures that AI-generated images (belongs_to='assistant') trigger the MESSAGE_FILE event,
        allowing the frontend to properly display generated image files with url field.
        """
        cycle_db.add(_message_file())
        cycle_db.commit()

        with current_app.app_context():
            result = message_cycle_manager.get_message_event_type("test-message-id")

        assert result == StreamEvent.MESSAGE_FILE
        assert "test-message-id" in message_cycle_manager._message_has_file

    def test_get_message_event_type_with_user_file(self, message_cycle_manager, cycle_db: Session):
        """Test get_message_event_type returns MESSAGE when message only has user-uploaded files.

        This is a regression test for the issue where user-uploaded images (belongs_to='user')
        caused the LLM text response to be incorrectly tagged with MESSAGE_FILE event,
        resulting in broken images in the chat UI. The query filters for belongs_to='assistant',
        so when only user files exist, the database query returns None, resulting in MESSAGE event type.
        """
        cycle_db.add(_message_file(belongs_to=MessageFileBelongsTo.USER))
        cycle_db.commit()

        with current_app.app_context():
            result = message_cycle_manager.get_message_event_type("test-message-id")

        assert result == StreamEvent.MESSAGE
        assert "test-message-id" not in message_cycle_manager._message_has_file

    def test_get_message_event_type_without_message_file(self, message_cycle_manager, cycle_db: Session):
        """Test get_message_event_type returns MESSAGE when message has no files."""
        assert list(cycle_db.scalars(select(MessageFile)).all()) == []

        with current_app.app_context():
            result = message_cycle_manager.get_message_event_type("test-message-id")

        assert result == StreamEvent.MESSAGE

    def test_get_message_event_type_uses_cache_without_query(
        self, message_cycle_manager, cycle_db: Session, sqlite_engine: Engine
    ):
        """Return MESSAGE_FILE directly from in-memory cache without opening a DB session."""
        message_cycle_manager._message_has_file.add("cached-message")
        statements: list[str] = []

        def record_statement(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
            statements.append(statement)

        event.listen(sqlite_engine, "before_cursor_execute", record_statement)
        try:
            result = message_cycle_manager.get_message_event_type("cached-message")
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", record_statement)

        assert result == StreamEvent.MESSAGE_FILE
        assert statements == []

    def test_message_to_stream_response_with_precomputed_event_type(self, message_cycle_manager, cycle_db: Session):
        """MessageCycleManager.message_to_stream_response expects a valid event_type; callers should precompute it."""
        cycle_db.add(_message_file())
        cycle_db.commit()

        with current_app.app_context():
            event_type = message_cycle_manager.get_message_event_type("test-message-id")
            result = message_cycle_manager.message_to_stream_response(
                answer="Hello world", message_id="test-message-id", event_type=event_type
            )

        assert isinstance(result, MessageStreamResponse)
        assert result.answer == "Hello world"
        assert result.id == "test-message-id"
        assert result.event == StreamEvent.MESSAGE_FILE

    def test_message_to_stream_response_with_event_type_skips_query(
        self, message_cycle_manager, cycle_db: Session, sqlite_engine: Engine
    ):
        """Test that message_to_stream_response skips database query when event_type is provided."""
        statements: list[str] = []

        def record_statement(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
            statements.append(statement)

        event.listen(sqlite_engine, "before_cursor_execute", record_statement)
        try:
            result = message_cycle_manager.message_to_stream_response(
                answer="Hello world", message_id="test-message-id", event_type=StreamEvent.MESSAGE
            )
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", record_statement)

        assert isinstance(result, MessageStreamResponse)
        assert result.answer == "Hello world"
        assert result.id == "test-message-id"
        assert result.event == StreamEvent.MESSAGE
        assert statements == []

    def test_message_to_stream_response_with_from_variable_selector(self, message_cycle_manager):
        """Test message_to_stream_response with from_variable_selector parameter."""
        result = message_cycle_manager.message_to_stream_response(
            answer="Hello world",
            message_id="test-message-id",
            from_variable_selector=["var1", "var2"],
            event_type=StreamEvent.MESSAGE,
        )

        assert isinstance(result, MessageStreamResponse)
        assert result.answer == "Hello world"
        assert result.id == "test-message-id"
        assert result.from_variable_selector == ["var1", "var2"]
        assert result.event == StreamEvent.MESSAGE

    def test_optimization_usage_example(self, message_cycle_manager, cycle_db: Session, sqlite_engine: Engine):
        """Test the optimization pattern that should be used by callers."""
        statements: list[str] = []

        def record_statement(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
            statements.append(statement)

        event.listen(sqlite_engine, "before_cursor_execute", record_statement)
        try:
            with current_app.app_context():
                event_type = message_cycle_manager.get_message_event_type("test-message-id")
            chunk1_response = message_cycle_manager.message_to_stream_response(
                answer="Chunk 1", message_id="test-message-id", event_type=event_type
            )
            chunk2_response = message_cycle_manager.message_to_stream_response(
                answer="Chunk 2", message_id="test-message-id", event_type=event_type
            )
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", record_statement)

        assert event_type == StreamEvent.MESSAGE
        assert len([statement for statement in statements if statement.lstrip().upper().startswith("SELECT")]) == 1
        assert chunk1_response.event == StreamEvent.MESSAGE
        assert chunk2_response.event == StreamEvent.MESSAGE
        assert chunk1_response.answer == "Chunk 1"
        assert chunk2_response.answer == "Chunk 2"

    def test_generate_conversation_name_returns_none_for_completion(self, message_cycle_manager):
        """Return None when completion entities are used for conversation naming.

        Args: message_cycle_manager with DummyCompletion injected as CompletionAppGenerateEntity.
        Returns: None, indicating no name generation for completion apps.
        Side effects: None expected.
        """

        class DummyCompletion:
            pass

        with patch("core.app.task_pipeline.message_cycle_manager.CompletionAppGenerateEntity", DummyCompletion):
            message_cycle_manager._application_generate_entity = DummyCompletion()
            result = message_cycle_manager.generate_conversation_name(conversation_id="c1", query="hi")

        assert result is None

    def test_generate_conversation_name_starts_thread_and_flips_first_message_flag(self, message_cycle_manager):
        """Spawn background generation thread for the first chat message."""
        message_cycle_manager._application_generate_entity.is_new_conversation = True
        message_cycle_manager._application_generate_entity.extras = {"auto_generate_conversation_name": True}
        flask_app = object()

        class DummyTimer:
            def __init__(self, interval, function, args=None, kwargs=None):
                self.interval = interval
                self.function = function
                self.args = args or []
                self.kwargs = kwargs
                self.daemon = False
                self.started = False

            def start(self):
                self.started = True

        with (
            patch(
                "core.app.task_pipeline.message_cycle_manager.current_app",
                new=SimpleNamespace(_get_current_object=lambda: flask_app),
            ),
            patch("core.app.task_pipeline.message_cycle_manager.Timer", DummyTimer),
        ):
            thread = message_cycle_manager.generate_conversation_name(conversation_id="conv-1", query="hello")

        assert isinstance(thread, DummyTimer)
        assert thread.interval == 1
        assert thread.function == message_cycle_manager._generate_conversation_name_worker
        assert thread.started is True
        assert thread.daemon is True
        assert thread.kwargs["flask_app"] is flask_app
        assert thread.kwargs["conversation_id"] == "conv-1"
        assert thread.kwargs["query"] == "hello"
        assert message_cycle_manager._application_generate_entity.is_new_conversation is False

    def test_generate_conversation_name_skips_thread_when_auto_generate_disabled(self, message_cycle_manager):
        """Skip thread creation when auto naming is disabled but still mark conversation as not new."""
        message_cycle_manager._application_generate_entity.is_new_conversation = True
        message_cycle_manager._application_generate_entity.extras = {"auto_generate_conversation_name": False}

        with patch("core.app.task_pipeline.message_cycle_manager.Timer") as mock_timer:
            result = message_cycle_manager.generate_conversation_name(conversation_id="conv-2", query="hello")

        assert result is None
        assert message_cycle_manager._application_generate_entity.is_new_conversation is False
        mock_timer.assert_not_called()

    def test_generate_conversation_name_worker_returns_when_conversation_missing(
        self, message_cycle_manager, cycle_db: Session
    ):
        """Return early when the conversation cannot be found."""
        flask_app = Flask(__name__)
        assert list(cycle_db.scalars(select(Conversation)).all()) == []

        message_cycle_manager._generate_conversation_name_worker(flask_app, "conv-missing", "hello")

        assert list(cycle_db.scalars(select(Conversation)).all()) == []

    def test_generate_conversation_name_worker_returns_when_app_missing(self, message_cycle_manager, cycle_db: Session):
        """Return early when non-completion conversation has no app relation."""
        flask_app = Flask(__name__)
        conversation = _conversation()
        cycle_db.add(conversation)
        cycle_db.commit()

        message_cycle_manager._generate_conversation_name_worker(flask_app, "conv-1", "hello")

        assert cycle_db.get(Conversation, "conv-1").name == ""
        assert cycle_db.get(App, "app-id") is None

    def test_generate_conversation_name_worker_uses_cached_name(
        self, message_cycle_manager, cycle_db: Session, sqlite_engine: Engine
    ):
        """Use cached conversation name when present and avoid LLM call."""
        flask_app = Flask(__name__)
        cycle_db.add_all([_app(), _conversation()])
        cycle_db.commit()

        with (
            patch("core.app.task_pipeline.message_cycle_manager.redis_client") as mock_redis,
            patch("core.app.task_pipeline.message_cycle_manager.LLMGenerator") as mock_llm_generator,
        ):
            mock_redis.get.return_value = b"cached-title"

            message_cycle_manager._generate_conversation_name_worker(flask_app, "conv-1", "hello")

        assert cycle_db.in_transaction() is False
        with Session(sqlite_engine) as verification_session:
            conversation = verification_session.get(Conversation, "conv-1")
        assert conversation is not None
        assert conversation.name == "cached-title"
        mock_llm_generator.generate_conversation_name.assert_not_called()
        mock_redis.setex.assert_not_called()

    def test_generate_conversation_name_worker_generates_and_caches_name(
        self, message_cycle_manager, cycle_db: Session, sqlite_engine: Engine
    ):
        """Generate conversation name and write it to redis cache on cache miss."""
        flask_app = Flask(__name__)
        cycle_db.add_all([_app(), _conversation()])
        cycle_db.commit()

        with (
            patch("core.app.task_pipeline.message_cycle_manager.redis_client") as mock_redis,
            patch("core.app.task_pipeline.message_cycle_manager.LLMGenerator") as mock_llm_generator,
        ):
            mock_redis.get.return_value = None
            mock_llm_generator.generate_conversation_name.return_value = "generated-title"

            message_cycle_manager._generate_conversation_name_worker(flask_app, "conv-1", "hello")

        assert cycle_db.in_transaction() is False
        with Session(sqlite_engine) as verification_session:
            conversation = verification_session.get(Conversation, "conv-1")
        assert conversation is not None
        assert conversation.name == "generated-title"
        mock_redis.setex.assert_called_once()

    def test_generate_conversation_name_worker_falls_back_when_generation_fails(
        self,
        message_cycle_manager,
        cycle_db: Session,
        sqlite_engine: Engine,
        caplog: pytest.LogCaptureFixture,
    ):
        """Fallback to truncated query when LLM generation fails."""
        flask_app = Flask(__name__)
        cycle_db.add_all([_app(), _conversation()])
        cycle_db.commit()
        long_query = "q" * 60

        with (
            patch("core.app.task_pipeline.message_cycle_manager.redis_client") as mock_redis,
            patch("core.app.task_pipeline.message_cycle_manager.LLMGenerator") as mock_llm_generator,
            patch("core.app.task_pipeline.message_cycle_manager.dify_config") as mock_dify_config,
        ):
            mock_redis.get.return_value = None
            mock_llm_generator.generate_conversation_name.side_effect = RuntimeError("generation failed")
            mock_dify_config.DEBUG = True

            with caplog.at_level(logging.ERROR, logger="core.app.task_pipeline.message_cycle_manager"):
                message_cycle_manager._generate_conversation_name_worker(flask_app, "conv-1", long_query)

        assert cycle_db.in_transaction() is False
        with Session(sqlite_engine) as verification_session:
            conversation = verification_session.get(Conversation, "conv-1")
        assert conversation is not None
        assert conversation.name == (long_query[:47] + "...")
        assert any(record.levelno == logging.ERROR for record in caplog.records)

    def test_handle_annotation_reply_sets_metadata(self, message_cycle_manager):
        """Populate task metadata from annotation reply events.

        Args: message_cycle_manager with TaskStateMetadata and a mocked AppAnnotationService.
        Returns: The fetched annotation object.
        Side effects: Updates metadata.annotation_reply with id and account name.
        """
        message_cycle_manager._task_state = SimpleNamespace(metadata=TaskStateMetadata())

        annotation = SimpleNamespace(
            id="ann-1",
            account_id="acct-1",
        )
        session = Mock()

        with (
            patch("core.app.task_pipeline.message_cycle_manager.AppAnnotationService") as mock_service,
            patch("core.app.task_pipeline.message_cycle_manager.AccountService") as account_service,
        ):
            mock_service.get_annotation_by_id.return_value = annotation
            account_service.get_account_by_id.return_value = SimpleNamespace(name="Alice")

            result = message_cycle_manager.handle_annotation_reply(
                QueueAnnotationReplyEvent(message_annotation_id="ann-1"), session
            )

        assert result == annotation
        assert message_cycle_manager._task_state.metadata.annotation_reply.id == "ann-1"
        assert message_cycle_manager._task_state.metadata.annotation_reply.account.name == "Alice"
        account_service.get_account_by_id.assert_called_once_with("acct-1", session=session)

    def test_handle_annotation_reply_returns_none_when_missing(self, message_cycle_manager):
        """Return None and keep metadata unchanged when annotation is not found."""
        message_cycle_manager._task_state = SimpleNamespace(metadata=TaskStateMetadata())

        with patch("core.app.task_pipeline.message_cycle_manager.AppAnnotationService") as mock_service:
            mock_service.get_annotation_by_id.return_value = None

            result = message_cycle_manager.handle_annotation_reply(
                QueueAnnotationReplyEvent(message_annotation_id="missing"), Mock()
            )

        assert result is None
        assert message_cycle_manager._task_state.metadata.annotation_reply is None

    def test_handle_retriever_resources_merges_and_deduplicates(self, message_cycle_manager):
        """Merge retriever resources, deduplicate, and preserve ordering positions.

        Args: message_cycle_manager with show_retrieve_source enabled and existing metadata.
        Returns: None.
        Side effects: Updates metadata.retriever_resources with unique items and positions.
        """
        message_cycle_manager._application_generate_entity.app_config = SimpleNamespace(
            additional_features=SimpleNamespace(show_retrieve_source=True)
        )
        existing = RetrievalSourceMetadata(dataset_id="d1", document_id="doc1")
        message_cycle_manager._task_state = SimpleNamespace(metadata=TaskStateMetadata(retriever_resources=[existing]))

        duplicate = RetrievalSourceMetadata(dataset_id="d1", document_id="doc1")
        new_resource = RetrievalSourceMetadata(dataset_id="d2", document_id="doc2")

        event = QueueRetrieverResourcesEvent(retriever_resources=[duplicate, new_resource])
        message_cycle_manager.handle_retriever_resources(event)

        assert len(message_cycle_manager._task_state.metadata.retriever_resources) == 2
        assert message_cycle_manager._task_state.metadata.retriever_resources[0].position == 1
        assert message_cycle_manager._task_state.metadata.retriever_resources[1].position == 2

    def test_message_file_to_stream_response_builds_signed_url(self, message_cycle_manager, cycle_db: Session):
        """Build a stream response with a signed tool file URL.

        Args: message_cycle_manager with a persisted MessageFile and mocked sign_tool_file.
        Returns: MessageStreamResponse with signed url and belongs_to normalized to user.
        Side effects: Calls sign_tool_file for tool file ids.
        """
        message_cycle_manager._application_generate_entity.task_id = "task-1"
        cycle_db.add(
            _message_file(
                file_id="file-1",
                message_id="msg-1",
                belongs_to=None,
                url="tool://file.verylongextension",
            )
        )
        cycle_db.commit()

        with patch("core.app.task_pipeline.message_cycle_manager.sign_tool_file") as mock_sign:
            mock_sign.return_value = "signed-url"

            response = message_cycle_manager.message_file_to_stream_response(SimpleNamespace(message_file_id="file-1"))

        assert response.url == "signed-url"
        assert response.belongs_to == "user"
        mock_sign.assert_called_once_with(tool_file_id="file", extension=".bin")

    def test_handle_retriever_resources_requires_features(self, message_cycle_manager):
        """Raise when retriever resources are handled without feature config.

        Args: message_cycle_manager with additional_features unset and empty metadata.
        Raises: ValueError when show_retrieve_source configuration is missing.
        """
        message_cycle_manager._application_generate_entity.app_config = SimpleNamespace(additional_features=None)
        message_cycle_manager._task_state = SimpleNamespace(metadata=TaskStateMetadata())

        with pytest.raises(ValueError):
            message_cycle_manager.handle_retriever_resources(QueueRetrieverResourcesEvent(retriever_resources=[]))

    def test_handle_retriever_resources_skips_none_entries(self, message_cycle_manager):
        """Ignore null resource entries while preserving valid resources."""
        message_cycle_manager._application_generate_entity.app_config = SimpleNamespace(
            additional_features=SimpleNamespace(show_retrieve_source=True)
        )
        message_cycle_manager._task_state = SimpleNamespace(metadata=TaskStateMetadata(retriever_resources=[]))
        resource = RetrievalSourceMetadata(dataset_id="d1", document_id="doc1")

        message_cycle_manager.handle_retriever_resources(SimpleNamespace(retriever_resources=[None, resource]))

        assert len(message_cycle_manager._task_state.metadata.retriever_resources) == 1
        assert message_cycle_manager._task_state.metadata.retriever_resources[0].position == 1

    def test_message_file_to_stream_response_uses_http_url_directly(self, message_cycle_manager, cycle_db: Session):
        """Use original URL when message file URL is already HTTP."""
        message_cycle_manager._application_generate_entity.task_id = "task-http"
        cycle_db.add(
            _message_file(
                file_id="file-http",
                message_id="msg-http",
                belongs_to=MessageFileBelongsTo.ASSISTANT,
                url="http://example.com/pic.png",
            )
        )
        cycle_db.commit()

        response = message_cycle_manager.message_file_to_stream_response(SimpleNamespace(message_file_id="file-http"))

        assert response is not None
        assert response.url == "http://example.com/pic.png"
        assert "msg-http" in message_cycle_manager._message_has_file

    def test_message_file_to_stream_response_defaults_extension_to_bin_without_dot(
        self, message_cycle_manager, cycle_db: Session
    ):
        """Default tool file extension to .bin when URL has no extension part."""
        message_cycle_manager._application_generate_entity.task_id = "task-bin"
        cycle_db.add(
            _message_file(
                file_id="file-bin",
                message_id="msg-bin",
                belongs_to=MessageFileBelongsTo.ASSISTANT,
                url="tool-file-id",
                file_type=FileType.CUSTOM,
            )
        )
        cycle_db.commit()

        with patch("core.app.task_pipeline.message_cycle_manager.sign_tool_file") as mock_sign:
            mock_sign.return_value = "signed-bin-url"

            response = message_cycle_manager.message_file_to_stream_response(
                SimpleNamespace(message_file_id="file-bin")
            )

        assert response is not None
        assert response.url == "signed-bin-url"
        mock_sign.assert_called_once_with(tool_file_id="tool-file-id", extension=".bin")

    def test_message_file_to_stream_response_returns_none_when_file_missing(
        self, message_cycle_manager, cycle_db: Session
    ):
        """Return None when message file lookup does not find a record."""
        assert list(cycle_db.scalars(select(MessageFile)).all()) == []

        response = message_cycle_manager.message_file_to_stream_response(SimpleNamespace(message_file_id="missing"))

        assert response is None

    def test_message_replace_to_stream_response_returns_reason(self, message_cycle_manager):
        """Include the provided replacement reason in the stream payload."""
        response = message_cycle_manager.message_replace_to_stream_response("replaced", reason="moderation")

        assert response.answer == "replaced"
        assert response.reason == "moderation"
