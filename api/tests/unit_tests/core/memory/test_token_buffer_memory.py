"""Comprehensive SQLite-backed tests for token-buffer memory."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from core.memory import token_buffer_memory as memory_module
from core.memory.token_buffer_memory import TokenBufferMemory
from graphon.file import FileTransferMethod, FileType
from graphon.model_runtime.entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessageRole,
    TextPromptMessageContent,
    UserPromptMessage,
)
from models.base import TypeBase
from models.enums import ConversationFromSource, CreatorUserRole, MessageFileBelongsTo
from models.model import AppMode, Message, MessageFile
from models.workflow import Workflow, WorkflowType

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
        tables=[Message.__table__, MessageFile.__table__, Workflow.__table__],
    )
    statements: list[tuple[str, object]] = []

    def record_statement(_connection, _cursor, statement, parameters, _context, _executemany) -> None:
        statements.append((statement, parameters))

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        database = Database(engine=sqlite_engine, session=session, statements=statements)
        monkeypatch.setattr(memory_module, "db", database)
        yield database
    event.remove(sqlite_engine, "before_cursor_execute", record_statement)


def _make_conversation(mode: AppMode = AppMode.CHAT) -> MagicMock:
    """Return a minimal Conversation mock."""
    conv = MagicMock()
    conv.id = str(uuid4())
    conv.mode = mode
    conv.model_config = {}
    return conv


def _make_model_instance() -> MagicMock:
    """Return a ModelInstance mock whose token counter returns a constant."""
    mi = MagicMock()
    mi.get_llm_num_tokens.return_value = 100
    return mi


def _make_message(answer: str = "hello", answer_tokens: int = 5) -> MagicMock:
    msg = MagicMock()
    msg.id = str(uuid4())
    msg.query = "user query"
    msg.answer = answer
    msg.answer_tokens = answer_tokens
    msg.workflow_run_id = str(uuid4())
    msg.created_at = MagicMock()
    return msg


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


# ===========================================================================
# Tests for __init__ and workflow_run_repo property
# ===========================================================================


class TestInit:
    def test_init_stores_conversation_and_model_instance(self):
        conv = _make_conversation()
        mi = _make_model_instance()
        mem = TokenBufferMemory(conversation=conv, model_instance=mi)
        assert mem.conversation is conv
        assert mem.model_instance is mi
        assert mem._workflow_run_repo is None

    def test_workflow_run_repo_is_created_lazily(self, database: Database):
        conv = _make_conversation()
        mi = _make_model_instance()
        mem = TokenBufferMemory(conversation=conv, model_instance=mi)

        mock_repo = MagicMock()
        with patch(
            "core.memory.token_buffer_memory.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
            return_value=mock_repo,
        ) as repository_factory:
            repo = mem.workflow_run_repo
            assert repo is mock_repo
            assert mem._workflow_run_repo is mock_repo

        session_factory = repository_factory.call_args.args[0]
        with session_factory() as session:
            assert isinstance(session, Session)
            assert session.get_bind() is database.engine

    def test_workflow_run_repo_cached_after_first_access(self):
        conv = _make_conversation()
        mi = _make_model_instance()
        mem = TokenBufferMemory(conversation=conv, model_instance=mi)

        existing_repo = MagicMock()
        mem._workflow_run_repo = existing_repo

        with patch(
            "core.memory.token_buffer_memory.DifyAPIRepositoryFactory.create_api_workflow_run_repository"
        ) as mock_factory:
            repo = mem.workflow_run_repo
            mock_factory.assert_not_called()
            assert repo is existing_repo


# ===========================================================================
# Tests for _build_prompt_message_with_files
# ===========================================================================


class TestBuildPromptMessageWithFiles:
    """Tests for the private _build_prompt_message_with_files method."""

    # ------------------------------------------------------------------
    # Mode: CHAT / AGENT_CHAT / COMPLETION (simple branch)
    # ------------------------------------------------------------------

    @pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION])
    def test_chat_mode_no_files_user_message(self, mode):
        """When file_extra_config is falsy or app_record is None → plain UserPromptMessage."""
        conv = _make_conversation(mode)
        mi = _make_model_instance()
        mem = TokenBufferMemory(conversation=conv, model_instance=mi)

        with patch(
            "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
            return_value=None,  # falsy → file_objs = []
        ):
            result = mem._build_prompt_message_with_files(
                message_files=[],
                text_content="hello",
                message=_make_message(),
                app_record=MagicMock(),
                is_user_message=True,
            )

        assert isinstance(result, UserPromptMessage)
        assert result.content == "hello"

    @pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION])
    def test_chat_mode_no_files_assistant_message(self, mode):
        """Plain AssistantPromptMessage when no files and is_user_message=False."""
        conv = _make_conversation(mode)
        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

        with patch(
            "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
            return_value=None,
        ):
            result = mem._build_prompt_message_with_files(
                message_files=[],
                text_content="ai reply",
                message=_make_message(),
                app_record=None,
                is_user_message=False,
            )

        assert isinstance(result, AssistantPromptMessage)
        assert result.content == "ai reply"

    @pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION])
    def test_chat_mode_with_files_user_message(self, mode):
        """When files are present, returns UserPromptMessage with list content."""
        conv = _make_conversation(mode)
        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

        mock_file_extra_config = MagicMock()
        mock_file_extra_config.image_config = None  # no detail override

        mock_file_obj = MagicMock()
        # Must be a real entity so Pydantic's tagged union discriminator can validate it
        real_image_content = ImagePromptMessageContent(
            url="http://example.com/img.png", format="png", mime_type="image/png"
        )

        mock_message_file = MagicMock()
        mock_app_record = MagicMock()
        mock_app_record.tenant_id = "tenant-1"

        with (
            patch(
                "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
                return_value=mock_file_extra_config,
            ),
            patch(
                "core.memory.token_buffer_memory.file_factory.build_from_message_file",
                return_value=mock_file_obj,
            ),
            patch(
                "core.memory.token_buffer_memory.file_manager.to_prompt_message_content",
                return_value=real_image_content,
            ),
        ):
            result = mem._build_prompt_message_with_files(
                message_files=[mock_message_file],
                text_content="user text",
                message=_make_message(),
                app_record=mock_app_record,
                is_user_message=True,
            )

        assert isinstance(result, UserPromptMessage)
        assert isinstance(result.content, list)
        # Last element should be TextPromptMessageContent
        assert isinstance(result.content[-1], TextPromptMessageContent)
        assert result.content[-1].data == "user text"

    def test_replay_does_not_pass_config_to_file_factory(self):
        """Replay contract: history files were validated on upload, so this
        path must not forward a FileUploadConfig. The factory's signature
        no longer accepts ``config``; this test guards against a future
        regression that re-introduces it."""
        conv = _make_conversation(AppMode.CHAT)
        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

        mock_file_extra_config = MagicMock()
        mock_file_extra_config.image_config = None

        real_image_content = ImagePromptMessageContent(
            url="http://example.com/img.png", format="png", mime_type="image/png"
        )
        mock_app_record = MagicMock()
        mock_app_record.tenant_id = "tenant-1"

        with (
            patch(
                "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
                return_value=mock_file_extra_config,
            ),
            patch(
                "core.memory.token_buffer_memory.file_factory.build_from_message_file",
                return_value=MagicMock(),
            ) as mock_build,
            patch(
                "core.memory.token_buffer_memory.file_manager.to_prompt_message_content",
                return_value=real_image_content,
            ),
        ):
            mem._build_prompt_message_with_files(
                message_files=[MagicMock()],
                text_content="user text",
                message=_make_message(),
                app_record=mock_app_record,
                is_user_message=True,
            )

        mock_build.assert_called_once()
        assert "config" not in mock_build.call_args.kwargs

    @pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION])
    def test_chat_mode_with_files_assistant_message(self, mode):
        """When files are present, returns AssistantPromptMessage with list content."""
        conv = _make_conversation(mode)
        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

        mock_file_extra_config = MagicMock()
        mock_file_extra_config.image_config = None

        mock_file_obj = MagicMock()
        real_image_content = ImagePromptMessageContent(
            url="http://example.com/img.png", format="png", mime_type="image/png"
        )
        mock_app_record = MagicMock()
        mock_app_record.tenant_id = "tenant-1"

        with (
            patch(
                "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
                return_value=mock_file_extra_config,
            ),
            patch(
                "core.memory.token_buffer_memory.file_factory.build_from_message_file",
                return_value=mock_file_obj,
            ),
            patch(
                "core.memory.token_buffer_memory.file_manager.to_prompt_message_content",
                return_value=real_image_content,
            ),
        ):
            result = mem._build_prompt_message_with_files(
                message_files=[MagicMock()],
                text_content="ai text",
                message=_make_message(),
                app_record=mock_app_record,
                is_user_message=False,
            )

        assert isinstance(result, AssistantPromptMessage)
        assert isinstance(result.content, list)

    @pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION])
    def test_chat_mode_with_files_image_detail_overridden(self, mode):
        """When image_config.detail is set, detail is taken from config."""
        conv = _make_conversation(mode)
        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

        mock_image_config = MagicMock()
        mock_image_config.detail = ImagePromptMessageContent.DETAIL.LOW

        mock_file_extra_config = MagicMock()
        mock_file_extra_config.image_config = mock_image_config

        mock_app_record = MagicMock()
        mock_app_record.tenant_id = "tenant-1"

        real_image_content = ImagePromptMessageContent(
            url="http://example.com/img.png", format="png", mime_type="image/png"
        )

        with (
            patch(
                "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
                return_value=mock_file_extra_config,
            ),
            patch(
                "core.memory.token_buffer_memory.file_factory.build_from_message_file",
                return_value=MagicMock(),
            ),
            patch(
                "core.memory.token_buffer_memory.file_manager.to_prompt_message_content",
                return_value=real_image_content,
            ) as mock_to_prompt,
        ):
            mem._build_prompt_message_with_files(
                message_files=[MagicMock()],
                text_content="user text",
                message=_make_message(),
                app_record=mock_app_record,
                is_user_message=True,
            )
            # Ensure the LOW detail was passed through
            mock_to_prompt.assert_called_once_with(
                mock_to_prompt.call_args[0][0], image_detail_config=ImagePromptMessageContent.DETAIL.LOW
            )

    @pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION])
    def test_chat_mode_app_record_none_returns_empty_file_objs(self, mode):
        """app_record=None path → file_objs stays empty → plain messages."""
        conv = _make_conversation(mode)
        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

        mock_file_extra_config = MagicMock()

        with patch(
            "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
            return_value=mock_file_extra_config,
        ):
            result = mem._build_prompt_message_with_files(
                message_files=[MagicMock()],
                text_content="hello",
                message=_make_message(),
                app_record=None,  # <-- forces the else branch → file_objs = []
                is_user_message=True,
            )

        assert isinstance(result, UserPromptMessage)
        assert result.content == "hello"

    # ------------------------------------------------------------------
    # Mode: ADVANCED_CHAT / WORKFLOW
    # ------------------------------------------------------------------

    @pytest.mark.parametrize("mode", [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def test_workflow_mode_no_app_raises(self, mode):
        """Raises ValueError when conversation.app is falsy."""
        conv = _make_conversation(mode)
        conv.app = None
        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

        with pytest.raises(ValueError, match="App not found for conversation"):
            mem._build_prompt_message_with_files(
                message_files=[],
                text_content="text",
                message=_make_message(),
                app_record=MagicMock(),
                is_user_message=True,
            )

    @pytest.mark.parametrize("mode", [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def test_workflow_mode_no_workflow_run_id_raises(self, mode):
        """Raises ValueError when message.workflow_run_id is falsy."""
        conv = _make_conversation(mode)
        conv.app = MagicMock()

        message = _make_message()
        message.workflow_run_id = None  # force missing

        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

        with pytest.raises(ValueError, match="Workflow run ID not found"):
            mem._build_prompt_message_with_files(
                message_files=[],
                text_content="text",
                message=message,
                app_record=MagicMock(),
                is_user_message=True,
            )

    @pytest.mark.parametrize("mode", [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def test_workflow_mode_workflow_run_not_found_raises(self, mode):
        """Raises ValueError when workflow_run_repo returns None."""
        conv = _make_conversation(mode)
        mock_app = MagicMock()
        conv.app = mock_app

        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())
        mem._workflow_run_repo = MagicMock()
        mem._workflow_run_repo.get_workflow_run_by_id.return_value = None

        with pytest.raises(ValueError, match="Workflow run not found"):
            mem._build_prompt_message_with_files(
                message_files=[],
                text_content="text",
                message=_make_message(),
                app_record=MagicMock(),
                is_user_message=True,
            )

    @pytest.mark.parametrize("mode", [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def test_workflow_mode_workflow_not_found_raises(self, mode, database: Database):
        """Raises ValueError when Workflow lookup returns None."""
        conv = _make_conversation(mode)
        conv.app = MagicMock()

        mock_workflow_run = MagicMock()
        mock_workflow_run.workflow_id = str(uuid4())

        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())
        mem._workflow_run_repo = MagicMock()
        mem._workflow_run_repo.get_workflow_run_by_id.return_value = mock_workflow_run

        with pytest.raises(ValueError, match="Workflow not found"):
            mem._build_prompt_message_with_files(
                message_files=[],
                text_content="text",
                message=_make_message(),
                app_record=MagicMock(),
                is_user_message=True,
            )

    @pytest.mark.parametrize("mode", [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def test_workflow_mode_success_no_files_user(self, mode, database: Database):
        """Happy path: workflow mode, no message files → plain UserPromptMessage."""
        conv = _make_conversation(mode)
        conv.app = MagicMock()

        mock_workflow_run = MagicMock()
        mock_workflow_run.workflow_id = str(uuid4())

        workflow = _persist_workflow(database, workflow_id=mock_workflow_run.workflow_id)

        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())
        mem._workflow_run_repo = MagicMock()
        mem._workflow_run_repo.get_workflow_run_by_id.return_value = mock_workflow_run

        with patch(
            "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
            return_value=None,
        ):
            result = mem._build_prompt_message_with_files(
                message_files=[],
                text_content="wf text",
                message=_make_message(),
                app_record=MagicMock(),
                is_user_message=True,
            )

        assert isinstance(result, UserPromptMessage)
        assert result.content == "wf text"
        assert database.session.get(Workflow, workflow.id) is workflow

    # ------------------------------------------------------------------
    # Invalid mode
    # ------------------------------------------------------------------

    def test_invalid_mode_raises_assertion(self):
        """Any unknown AppMode raises AssertionError."""
        conv = _make_conversation()
        conv.mode = "unknown_mode"  # not in any set
        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

        with pytest.raises(AssertionError, match="Invalid app mode"):
            mem._build_prompt_message_with_files(
                message_files=[],
                text_content="text",
                message=_make_message(),
                app_record=MagicMock(),
                is_user_message=True,
            )


# ===========================================================================
# Tests for get_history_prompt_messages
# ===========================================================================


class TestGetHistoryPromptMessages:
    """Tests for persisted history retrieval, file batching, and pruning."""

    def _make_memory(self, mode: AppMode = AppMode.CHAT) -> TokenBufferMemory:
        conv = _make_conversation(mode)
        conv.app = MagicMock()
        return TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

    def test_returns_empty_when_no_messages(self, database: Database) -> None:
        assert self._make_memory().get_history_prompt_messages() == []

    def test_skips_newest_message_without_answer(self, database: Database) -> None:
        mem = self._make_memory()
        message = _persist_message(database, mem.conversation.id, answer="", answer_tokens=0)

        assert mem.get_history_prompt_messages() == []
        assert database.session.get(Message, message.id) is message

    def test_message_with_answer_returns_user_and_assistant_prompts(self, database: Database) -> None:
        mem = self._make_memory()
        _persist_message(database, mem.conversation.id, query="My query", answer="My answer", answer_tokens=10)

        result = mem.get_history_prompt_messages()

        assert len(result) == 2
        assert isinstance(result[0], UserPromptMessage)
        assert result[0].content == "My query"
        assert isinstance(result[1], AssistantPromptMessage)
        assert result[1].content == "My answer"

    def test_history_is_conversation_scoped(self, database: Database) -> None:
        mem = self._make_memory()
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
        mem = self._make_memory()
        before = len(database.statements)

        mem.get_history_prompt_messages(message_limit=message_limit)

        statements = database.statements[before:]
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
        mem = self._make_memory()
        message = _persist_message(database, mem.conversation.id)
        message_file = _persist_message_file(database, message, belongs_to=belongs_to)
        built_prompt = (
            UserPromptMessage(content="built user")
            if is_user_message
            else AssistantPromptMessage(content="built assistant")
        )

        with patch.object(mem, "_build_prompt_message_with_files", return_value=built_prompt) as build_prompt:
            result = mem.get_history_prompt_messages()

        build_prompt.assert_called_once()
        assert build_prompt.call_args.kwargs["message_files"] == [message_file]
        assert build_prompt.call_args.kwargs["is_user_message"] is is_user_message
        assert built_prompt in result

    def test_message_files_are_batch_loaded_with_constant_query_count(self, database: Database) -> None:
        mem = self._make_memory()
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
        assert len(selects) == 3
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
        mem = self._make_memory()
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
        conv.app = MagicMock()
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
