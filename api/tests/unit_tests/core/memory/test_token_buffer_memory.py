"""Comprehensive SQLite-backed tests for token-buffer memory."""

import json
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

import models.model as model_module
from core.app.file_access import FileAccessControllerProtocol
from core.memory import token_buffer_memory as memory_module
from core.memory.token_buffer_memory import TokenBufferMemory
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageRole,
    TextPromptMessageContent,
    UserPromptMessage,
)
from models.base import TypeBase
from models.enums import ConversationFromSource, CreatorUserRole, MessageFileBelongsTo
from models.model import App, AppAnnotationSetting, AppMode, AppModelConfig, Conversation, Message, MessageFile
from models.workflow import (
    Workflow,
    WorkflowExecutionStatus,
    WorkflowRun,
    WorkflowRunTriggeredFrom,
    WorkflowType,
)

# ---------------------------------------------------------------------------
# Helpers / shared fixtures
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Database:
    """Typed SQLite binding plus executed SQL for query-count assertions."""

    engine: Engine
    session: Session
    statements: list[tuple[str, object]]


@pytest.fixture
def database(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Database]:
    TypeBase.metadata.create_all(
        sqlite_engine,
        tables=[
            App.__table__,
            Conversation.__table__,
            Message.__table__,
            MessageFile.__table__,
            Workflow.__table__,
            AppModelConfig.__table__,
            AppAnnotationSetting.__table__,
        ],
    )
    statements: list[tuple[str, object]] = []

    def record_statement(_connection, _cursor, statement, parameters, _context, _executemany) -> None:
        statements.append((statement, parameters))

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        database = Database(engine=sqlite_engine, session=session, statements=statements)
        monkeypatch.setattr(memory_module, "db", SimpleNamespace(engine=sqlite_engine, session=lambda: session))
        monkeypatch.setattr(model_module, "db", database)
        yield database
    event.remove(sqlite_engine, "before_cursor_execute", record_statement)


def _make_app(*, app_id: str | None = None, mode: AppMode = AppMode.CHAT) -> App:
    """Return a real transient app with the ownership fields used by memory."""
    return App(
        id=app_id or str(uuid4()),
        tenant_id=str(uuid4()),
        name="Memory test app",
        mode=mode,
        enable_site=False,
        enable_api=False,
    )


def _make_conversation(mode: AppMode = AppMode.CHAT, *, app_id: str | None = None) -> Conversation:
    """Return a real transient conversation configured without database-backed model settings."""
    return Conversation(
        id=str(uuid4()),
        app_id=app_id or str(uuid4()),
        mode=mode,
        name="Memory test conversation",
        override_model_configs="{}",
        _inputs={},
        from_source=ConversationFromSource.API,
    )


def _persist_conversation(database: Database, mode: AppMode = AppMode.CHAT) -> Conversation:
    app = _make_app(mode=mode)
    conversation = _make_conversation(mode, app_id=app.id)
    database.session.add_all([app, conversation])
    database.session.commit()
    return conversation


def _make_model_instance() -> MagicMock:
    """Return a ModelInstance mock whose token counter returns a constant."""
    mi = MagicMock()
    mi.get_llm_num_tokens.return_value = 100
    return mi


def _make_workflow_run(*, workflow_id: str | None = None) -> WorkflowRun:
    workflow_run = WorkflowRun(
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        workflow_id=workflow_id or str(uuid4()),
        type=WorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.SUCCEEDED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
    )
    workflow_run.id = str(uuid4())
    return workflow_run


def _persist_message(
    database: Database,
    conversation_id: str,
    *,
    query: str = "user query",
    answer: str = "hello",
    answer_tokens: int = 5,
    created_at: datetime | None = None,
    workflow_run_id: str | None = None,
) -> Message:
    message = Message(
        id=str(uuid4()),
        app_id="app-1",
        conversation_id=conversation_id,
        _inputs={},
        query=query,
        message={},
        message_unit_price=Decimal(0),
        answer=answer,
        answer_tokens=answer_tokens,
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        workflow_run_id=workflow_run_id,
        created_at=created_at or datetime.now(UTC).replace(tzinfo=None),
    )
    database.session.add(message)
    database.session.commit()
    return message


def _persist_message_file(
    database: Database,
    message: Message,
    *,
    belongs_to: MessageFileBelongsTo | None,
) -> MessageFile:
    message_file = MessageFile(
        message_id=message.id,
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        belongs_to=belongs_to,
        url="https://example.com/image.png",
    )
    database.session.add(message_file)
    database.session.commit()
    return message_file


def _persist_workflow(database: Database, *, workflow_id: str) -> Workflow:
    workflow = Workflow(
        id=workflow_id,
        tenant_id="tenant-1",
        app_id="app-1",
        type=WorkflowType.CHAT,
        version="1",
        graph="{}",
        features="{}",
        created_by="account-1",
    )
    database.session.add(workflow)
    database.session.commit()
    return workflow


def _enable_file_uploads(
    database: Database, conversation: Conversation, *, enabled: bool = True, detail: str = "high"
) -> None:
    conversation.override_model_configs = json.dumps(
        {
            "model": {"provider": "test", "name": "test", "completion_params": {}},
            "file_upload": {
                "enabled": enabled,
                "allowed_file_types": ["image"],
                "allowed_file_upload_methods": ["remote_url", "local_file", "tool_file"],
                "image": {"detail": detail},
            },
        }
    )
    database.session.commit()


# ===========================================================================
# Tests for get_history_prompt_messages
# ===========================================================================


class TestGetHistoryPromptMessages:
    """Tests for persisted history retrieval, file batching, and pruning."""

    def _make_memory(self, database: Database, mode: AppMode = AppMode.CHAT) -> TokenBufferMemory:
        conv = _persist_conversation(database, mode)
        return TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

    def test_returns_empty_when_no_messages(self, database: Database) -> None:
        assert self._make_memory(database).get_history_prompt_messages() == []

    def test_skips_newest_message_without_answer(self, database: Database) -> None:
        mem = self._make_memory(database)
        message = _persist_message(database, mem.conversation.id, answer="", answer_tokens=0)

        assert mem.get_history_prompt_messages() == []
        assert database.session.get(Message, message.id) is message

    def test_message_with_answer_returns_user_and_assistant_prompts(self, database: Database) -> None:
        mem = self._make_memory(database)
        _persist_message(database, mem.conversation.id, query="My query", answer="My answer", answer_tokens=10)

        result = mem.get_history_prompt_messages()

        assert len(result) == 2
        assert isinstance(result[0], UserPromptMessage)
        assert result[0].content == "My query"
        assert isinstance(result[1], AssistantPromptMessage)
        assert result[1].content == "My answer"

    def test_history_is_conversation_scoped(self, database: Database) -> None:
        mem = self._make_memory(database)
        _persist_message(database, mem.conversation.id, answer="visible")
        _persist_message(database, "other-conversation", answer="hidden")

        result = mem.get_history_prompt_messages()

        assert [prompt.content for prompt in result] == ["user query", "visible"]

    @pytest.mark.parametrize(
        ("message_limit", "expected_limit"),
        [(None, 500), (9999, 500), (10, 10), (0, 500)],
    )
    def test_message_limit_is_applied_to_executable_query(
        self,
        database: Database,
        message_limit: int | None,
        expected_limit: int,
    ) -> None:
        mem = self._make_memory(database)
        before = len(database.statements)

        mem.get_history_prompt_messages(message_limit=message_limit)

        statements = [entry for entry in database.statements[before:] if "FROM messages" in entry[0]]
        assert len(statements) == 1
        sql, parameters = statements[0]
        assert "LIMIT" in sql
        assert expected_limit in parameters

    @pytest.mark.parametrize(
        ("belongs_to", "is_user_message"),
        [
            (MessageFileBelongsTo.USER, True),
            (None, True),
            (MessageFileBelongsTo.ASSISTANT, False),
        ],
    )
    def test_message_files_use_persisted_ownership(
        self,
        database: Database,
        belongs_to: MessageFileBelongsTo | None,
        is_user_message: bool,
    ) -> None:
        mem = self._make_memory(database)
        message = _persist_message(database, mem.conversation.id)
        message_file = _persist_message_file(database, message, belongs_to=belongs_to)
        _enable_file_uploads(database, mem.conversation)
        app = database.session.get(App, mem.conversation.app_id)
        assert app is not None

        history = TokenBufferMemory.load_history(
            conversation=mem.conversation, app_record=app, session=database.session, message_limit=None
        )

        file_prompt = history.prompts[0 if is_user_message else 1]
        other_prompt = history.prompts[1 if is_user_message else 0]
        assert [reference.id for reference in file_prompt.files] == [message_file.id]
        assert file_prompt.is_user_message is is_user_message
        assert other_prompt.files == ()

    def test_message_files_are_batch_loaded_with_constant_query_count(self, database: Database) -> None:
        mem = self._make_memory(database)
        base_time = datetime.now(UTC).replace(tzinfo=None)
        messages = [
            _persist_message(
                database,
                mem.conversation.id,
                query=f"query-{index}",
                answer=f"answer-{index}",
                created_at=base_time + timedelta(seconds=index),
            )
            for index in range(5)
        ]
        before = len(database.statements)

        with patch("core.memory.token_buffer_memory.extract_thread_messages", return_value=messages):
            result = mem.get_history_prompt_messages()

        selects = [sql for sql, _ in database.statements[before:] if sql.lstrip().upper().startswith("SELECT")]
        assert len(selects) == 4
        assert sum("FROM apps" in sql for sql in selects) == 1
        assert len(result) == 10

    @pytest.mark.parametrize(
        ("token_values", "max_token_limit", "expected_length"),
        [
            ([3000, 1500], 2000, 1),
            ([99999, 99999], 1, 1),
            ([50], 2000, 2),
        ],
    )
    def test_token_pruning_uses_persisted_history(
        self,
        database: Database,
        token_values: list[int],
        max_token_limit: int,
        expected_length: int,
    ) -> None:
        mem = self._make_memory(database)
        mem.model_instance.get_llm_num_tokens.side_effect = token_values
        _persist_message(database, mem.conversation.id)

        result = mem.get_history_prompt_messages(max_token_limit=max_token_limit)

        assert len(result) == expected_length


# ===========================================================================
# Tests for get_history_prompt_text
# ===========================================================================


class TestGetHistoryPromptText:
    """Tests for get_history_prompt_text."""

    def _make_memory(self) -> TokenBufferMemory:
        conv = _make_conversation()
        return TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

    def test_empty_messages_returns_empty_string(self):
        mem = self._make_memory()
        with patch.object(mem, "get_history_prompt_messages", return_value=[]):
            result = mem.get_history_prompt_text()
        assert result == ""

    def test_user_and_assistant_messages_formatted(self):
        mem = self._make_memory()
        messages = [
            UserPromptMessage(content="Hello"),
            AssistantPromptMessage(content="World"),
        ]
        with patch.object(mem, "get_history_prompt_messages", return_value=messages):
            result = mem.get_history_prompt_text(human_prefix="H", ai_prefix="A")
        assert result == "H: Hello\nA: World"

    def test_custom_prefixes_applied(self):
        mem = self._make_memory()
        messages = [
            UserPromptMessage(content="Hi"),
            AssistantPromptMessage(content="Bye"),
        ]
        with patch.object(mem, "get_history_prompt_messages", return_value=messages):
            result = mem.get_history_prompt_text(human_prefix="Human", ai_prefix="Bot")
        assert "Human: Hi" in result
        assert "Bot: Bye" in result

    def test_list_content_with_text_and_image(self):
        """List content: TextPromptMessageContent → text; ImagePromptMessageContent → [image]."""
        mem = self._make_memory()
        messages = [
            UserPromptMessage(
                content=[
                    TextPromptMessageContent(data="caption"),
                    ImagePromptMessageContent(url="http://img", format="png", mime_type="image/png"),
                ]
            ),
        ]
        with patch.object(mem, "get_history_prompt_messages", return_value=messages):
            result = mem.get_history_prompt_text()
        assert "caption" in result
        assert "[image]" in result

    def test_list_content_text_only(self):
        mem = self._make_memory()
        messages = [
            UserPromptMessage(content=[TextPromptMessageContent(data="just text")]),
        ]
        with patch.object(mem, "get_history_prompt_messages", return_value=messages):
            result = mem.get_history_prompt_text()
        assert "just text" in result

    def test_list_content_image_only(self):
        mem = self._make_memory()
        messages = [
            UserPromptMessage(
                content=[
                    ImagePromptMessageContent(url="http://img", format="jpg", mime_type="image/jpeg"),
                ]
            ),
        ]
        with patch.object(mem, "get_history_prompt_messages", return_value=messages):
            result = mem.get_history_prompt_text()
        assert "[image]" in result

    def test_unknown_role_skipped(self):
        """Messages with a role that is not USER or ASSISTANT are skipped."""
        mem = self._make_memory()

        # Create a mock message with a SYSTEM role
        system_msg = MagicMock()
        system_msg.role = PromptMessageRole.SYSTEM
        system_msg.content = "system instruction"

        user_msg = UserPromptMessage(content="hi")

        with patch.object(mem, "get_history_prompt_messages", return_value=[system_msg, user_msg]):
            result = mem.get_history_prompt_text()

        assert "system instruction" not in result
        assert "Human: hi" in result

    def test_passes_max_token_limit_and_message_limit(self):
        """Parameters are forwarded to get_history_prompt_messages."""
        mem = self._make_memory()
        with patch.object(mem, "get_history_prompt_messages", return_value=[]) as mock_get:
            mem.get_history_prompt_text(max_token_limit=500, message_limit=10)
        mock_get.assert_called_once_with(max_token_limit=500, message_limit=10)

    def test_multiple_messages_joined_by_newline(self):
        mem = self._make_memory()
        messages = [
            UserPromptMessage(content="Q1"),
            AssistantPromptMessage(content="A1"),
            UserPromptMessage(content="Q2"),
            AssistantPromptMessage(content="A2"),
        ]
        with patch.object(mem, "get_history_prompt_messages", return_value=messages):
            result = mem.get_history_prompt_text()
        lines = result.split("\n")
        assert len(lines) == 4
        assert lines[0] == "Human: Q1"
        assert lines[1] == "Assistant: A1"
        assert lines[2] == "Human: Q2"
        assert lines[3] == "Assistant: A2"

    def test_assistant_list_content_formatted(self):
        """AssistantPromptMessage with list content is also handled."""
        mem = self._make_memory()
        messages = [
            AssistantPromptMessage(
                content=[
                    TextPromptMessageContent(data="response text"),
                    ImagePromptMessageContent(url="http://img2", format="png", mime_type="image/png"),
                ]
            ),
        ]
        with patch.object(mem, "get_history_prompt_messages", return_value=messages):
            result = mem.get_history_prompt_text()
        assert "response text" in result
        assert "[image]" in result


class TestPreparedHistory:
    @pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION])
    @pytest.mark.parametrize("detail", ["low", "high"])
    def test_load_detaches_history_before_attachment_and_token_io(
        self, database: Database, mode: AppMode, detail: str
    ) -> None:
        conversation = _persist_conversation(database, mode)
        _enable_file_uploads(database, conversation, detail=detail)
        message = _persist_message(database, conversation.id, query="question", answer="answer")
        message_file = _persist_message_file(database, message, belongs_to=MessageFileBelongsTo.USER)
        app = database.session.get(App, conversation.app_id)
        assert app is not None
        file_id, tenant_id = message_file.id, app.tenant_id
        model = _make_model_instance()

        with (
            patch.object(memory_module.file_factory, "build_from_mapping") as build_file,
            patch.object(memory_module.file_manager, "to_prompt_message_content") as to_prompt,
        ):
            history = TokenBufferMemory.load_history(
                conversation=conversation, app_record=app, session=database.session, message_limit=3
            )
            build_file.assert_not_called()
            to_prompt.assert_not_called()
            model.get_llm_num_tokens.assert_not_called()
            message.query = "later query"
            message_file.url = "https://example.com/later.png"
            database.session.close()
            statement_count = len(database.statements)

            def restore_file(
                *, mapping: Mapping[str, object], tenant_id: str, access_controller: FileAccessControllerProtocol
            ) -> File:
                assert not database.session.in_transaction()
                assert mapping["id"] == file_id
                assert mapping["url"] == "https://example.com/image.png"
                assert tenant_id
                assert access_controller is memory_module._file_access_controller
                return File(
                    filename="image.png",
                    file_type=FileType.IMAGE,
                    transfer_method=FileTransferMethod.REMOTE_URL,
                    remote_url="https://example.com/image.png",
                    mime_type="image/png",
                    extension=".png",
                    size=42,
                )

            def render_file(
                file: File, *, image_detail_config: ImagePromptMessageContent.DETAIL
            ) -> ImagePromptMessageContent:
                assert not database.session.in_transaction()
                assert image_detail_config == detail
                assert file.remote_url is not None
                return ImagePromptMessageContent(url=file.remote_url, format="png", mime_type="image/png")

            def count_tokens(prompts: Sequence[PromptMessage]) -> int:
                assert prompts
                assert not database.session.in_transaction()
                return 100

            build_file.side_effect = restore_file
            to_prompt.side_effect = render_file
            model.get_llm_num_tokens.side_effect = count_tokens
            text = history.get_prompt_text(model_instance=model, max_token_limit=3000)

        assert text == "Human: [image]\nquestion\nAssistant: answer"
        assert build_file.call_args.kwargs["tenant_id"] == tenant_id
        assert "config" not in build_file.call_args.kwargs
        assert len(database.statements) == statement_count

    @pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION])
    def test_disabled_file_uploads_keep_history_text(self, database: Database, mode: AppMode) -> None:
        conversation = _persist_conversation(database, mode)
        _enable_file_uploads(database, conversation, enabled=False)
        message = _persist_message(database, conversation.id)
        _persist_message_file(database, message, belongs_to=MessageFileBelongsTo.USER)
        app = database.session.get(App, conversation.app_id)
        history = TokenBufferMemory.load_history(
            conversation=conversation, app_record=app, session=database.session, message_limit=None
        )
        database.session.close()

        with patch.object(memory_module.file_factory, "build_from_mapping") as build_file:
            text = history.get_prompt_text(model_instance=_make_model_instance(), max_token_limit=3000)

        build_file.assert_not_called()
        assert text == "Human: user query\nAssistant: hello"

    @pytest.mark.parametrize("mode", [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def test_workflow_attachment_uses_message_run_configuration(self, database: Database, mode: AppMode) -> None:
        conversation = _persist_conversation(database, mode)
        workflow_run = _make_workflow_run()
        workflow = _persist_workflow(database, workflow_id=workflow_run.workflow_id)
        workflow.features = json.dumps({"file_upload": {"enabled": True}})
        message = _persist_message(database, conversation.id, workflow_run_id=workflow_run.id)
        _persist_message_file(database, message, belongs_to=MessageFileBelongsTo.ASSISTANT)
        app = database.session.get(App, conversation.app_id)
        assert app is not None
        repository = MagicMock()
        repository.get_workflow_run_by_id.return_value = workflow_run

        history = TokenBufferMemory.load_history(
            conversation=conversation,
            app_record=app,
            session=database.session,
            message_limit=3,
            workflow_run_repo=repository,
        )

        repository.get_workflow_run_by_id.assert_called_once_with(
            tenant_id=app.tenant_id,
            app_id=app.id,
            run_id=workflow_run.id,
        )
        assert history.prompts[0].files == ()
        assert len(history.prompts[1].files) == 1
        assert history.prompts[1].image_detail == ImagePromptMessageContent.DETAIL.HIGH

    @pytest.mark.parametrize(
        ("missing", "error"),
        [
            ("app", "App not found for conversation"),
            ("run_id", "Workflow run ID not found"),
            ("run", "Workflow run not found"),
            ("workflow", "Workflow not found"),
        ],
    )
    def test_workflow_attachment_missing_context_preserves_error(
        self, database: Database, missing: str, error: str
    ) -> None:
        conversation = _persist_conversation(database, AppMode.ADVANCED_CHAT)
        workflow_run = _make_workflow_run()
        message = _persist_message(
            database, conversation.id, workflow_run_id=None if missing == "run_id" else workflow_run.id
        )
        _persist_message_file(database, message, belongs_to=MessageFileBelongsTo.USER)
        app = None if missing == "app" else database.session.get(App, conversation.app_id)
        repository = MagicMock()
        repository.get_workflow_run_by_id.return_value = None if missing == "run" else workflow_run

        with pytest.raises(ValueError, match=error):
            TokenBufferMemory.load_history(
                conversation=conversation,
                app_record=app,
                session=database.session,
                message_limit=3,
                workflow_run_repo=repository,
            )

    def test_history_preserves_branch_order_and_skips_unfinished_leaf(self, database: Database) -> None:
        conversation = _persist_conversation(database)
        base = datetime.now(UTC).replace(tzinfo=None)
        parent = _persist_message(database, conversation.id, query="parent", created_at=base)
        sibling = _persist_message(database, conversation.id, query="sibling", created_at=base + timedelta(seconds=1))
        sibling.parent_message_id = parent.id
        child = _persist_message(database, conversation.id, query="child", created_at=base + timedelta(seconds=2))
        child.parent_message_id = parent.id
        leaf = _persist_message(
            database,
            conversation.id,
            query="unfinished",
            answer="",
            answer_tokens=0,
            created_at=base + timedelta(seconds=3),
        )
        leaf.parent_message_id = child.id
        database.session.commit()
        app = database.session.get(App, conversation.app_id)
        history = TokenBufferMemory.load_history(
            conversation=conversation,
            app_record=app,
            session=database.session,
            message_limit=4,
        )
        database.session.close()

        assert history.get_prompt_text(model_instance=_make_model_instance(), max_token_limit=3000) == (
            "Human: parent\nAssistant: hello\nHuman: child\nAssistant: hello"
        )

    def test_configured_workflow_repository_is_reused_for_history(self, database: Database) -> None:
        conversation = _persist_conversation(database, AppMode.ADVANCED_CHAT)
        workflow_run = _make_workflow_run()
        workflow = _persist_workflow(database, workflow_id=workflow_run.workflow_id)
        workflow.features = json.dumps({"file_upload": {"enabled": True}})
        parent = _persist_message(database, conversation.id, workflow_run_id=workflow_run.id)
        child = _persist_message(
            database,
            conversation.id,
            workflow_run_id=workflow_run.id,
            created_at=parent.created_at + timedelta(seconds=1),
        )
        child.parent_message_id = parent.id
        for message in (parent, child):
            _persist_message_file(database, message, belongs_to=MessageFileBelongsTo.USER)
        app = database.session.get(App, conversation.app_id)
        repository = MagicMock()
        repository.get_workflow_run_by_id.return_value = workflow_run

        with patch.object(
            memory_module.DifyAPIRepositoryFactory, "create_api_workflow_run_repository", return_value=repository
        ) as create_repository:
            history = TokenBufferMemory.load_history(
                conversation=conversation, app_record=app, session=database.session, message_limit=3
            )

        create_repository.assert_called_once()
        assert repository.get_workflow_run_by_id.call_count == 2
        assert len(history.prompts) == 4
        assert [len(prompt.files) for prompt in history.prompts] == [1, 0, 1, 0]
