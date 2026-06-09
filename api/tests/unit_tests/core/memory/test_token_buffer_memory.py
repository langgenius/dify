"""Comprehensive unit tests for core/memory/token_buffer_memory.py"""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from core.memory.token_buffer_memory import TokenBufferMemory
from graphon.model_runtime.entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessageRole,
    TextPromptMessageContent,
    UserPromptMessage,
)
from models.model import AppMode

# ---------------------------------------------------------------------------
# Helpers / shared fixtures
# ---------------------------------------------------------------------------


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

    def test_workflow_run_repo_is_created_lazily(self):
        conv = _make_conversation()
        mi = _make_model_instance()
        mem = TokenBufferMemory(conversation=conv, model_instance=mi)

        mock_repo = MagicMock()
        with (
            patch("core.memory.token_buffer_memory.sessionmaker") as mock_sm,
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch(
                "core.memory.token_buffer_memory.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
                return_value=mock_repo,
            ),
        ):
            mock_db.engine = MagicMock()
            repo = mem.workflow_run_repo
            assert repo is mock_repo
            assert mem._workflow_run_repo is mock_repo

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
    def test_workflow_mode_workflow_not_found_raises(self, mode):
        """Raises ValueError when Workflow lookup returns None."""
        conv = _make_conversation(mode)
        conv.app = MagicMock()

        mock_workflow_run = MagicMock()
        mock_workflow_run.workflow_id = str(uuid4())

        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())
        mem._workflow_run_repo = MagicMock()
        mem._workflow_run_repo.get_workflow_run_by_id.return_value = mock_workflow_run

        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
        ):
            mock_db.session.scalar.return_value = None  # workflow not found

            with pytest.raises(ValueError, match="Workflow not found"):
                mem._build_prompt_message_with_files(
                    message_files=[],
                    text_content="text",
                    message=_make_message(),
                    app_record=MagicMock(),
                    is_user_message=True,
                )

    @pytest.mark.parametrize("mode", [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def test_workflow_mode_success_no_files_user(self, mode):
        """Happy path: workflow mode, no message files → plain UserPromptMessage."""
        conv = _make_conversation(mode)
        conv.app = MagicMock()

        mock_workflow_run = MagicMock()
        mock_workflow_run.workflow_id = str(uuid4())

        mock_workflow = MagicMock()
        mock_workflow.features_dict = {}

        mem = TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())
        mem._workflow_run_repo = MagicMock()
        mem._workflow_run_repo.get_workflow_run_by_id.return_value = mock_workflow_run

        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch(
                "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
                return_value=None,
            ),
        ):
            mock_db.session.scalar.return_value = mock_workflow

            result = mem._build_prompt_message_with_files(
                message_files=[],
                text_content="wf text",
                message=_make_message(),
                app_record=MagicMock(),
                is_user_message=True,
            )

        assert isinstance(result, UserPromptMessage)
        assert result.content == "wf text"

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
    """Tests for get_history_prompt_messages."""

    def _make_memory(self, mode: AppMode = AppMode.CHAT) -> TokenBufferMemory:
        conv = _make_conversation(mode)
        conv.app = MagicMock()
        return TokenBufferMemory(conversation=conv, model_instance=_make_model_instance())

    def test_returns_empty_when_no_messages(self):
        mem = self._make_memory()
        with patch("core.memory.token_buffer_memory.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = []
            result = mem.get_history_prompt_messages()
        assert result == []

    def test_skips_first_message_without_answer(self):
        """The newest message (index 0 after extraction) without answer and tokens==0 is skipped."""
        mem = self._make_memory()

        msg_no_answer = _make_message(answer="", answer_tokens=0)
        msg_no_answer.parent_message_id = None  # ensures extract_thread_messages returns it

        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch(
                "core.memory.token_buffer_memory.extract_thread_messages",
                return_value=[msg_no_answer],
            ),
        ):
            mock_db.session.scalars.return_value.all.side_effect = [
                [msg_no_answer],  # first call: messages query
                [],  # second call: user files query (never hit, but safe)
            ]
            result = mem.get_history_prompt_messages()

        assert result == []

    def test_message_with_answer_not_skipped(self):
        """A message with a non-empty answer is NOT popped."""
        mem = self._make_memory()

        msg = _make_message(answer="some answer", answer_tokens=10)
        msg.parent_message_id = None

        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch(
                "core.memory.token_buffer_memory.extract_thread_messages",
                return_value=[msg],
            ),
            patch(
                "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
                return_value=None,
            ),
        ):
            # user files query → empty; assistant files query → empty
            mock_db.session.scalars.return_value.all.return_value = []
            result = mem.get_history_prompt_messages()

        assert len(result) == 2  # one user + one assistant

    def test_message_limit_default_is_500(self):
        """When message_limit is None the stmt is limited to 500."""
        mem = self._make_memory()
        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch("core.memory.token_buffer_memory.select") as mock_select,
            patch("core.memory.token_buffer_memory.extract_thread_messages", return_value=[]),
        ):
            mock_stmt = MagicMock()
            mock_select.return_value.where.return_value.order_by.return_value = mock_stmt
            mock_stmt.limit.return_value = mock_stmt
            mock_db.session.scalars.return_value.all.return_value = []

            mem.get_history_prompt_messages(message_limit=None)
            mock_stmt.limit.assert_called_with(500)

    def test_message_limit_clipped_to_500(self):
        """A message_limit > 500 is clamped to 500."""
        mem = self._make_memory()
        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch("core.memory.token_buffer_memory.select") as mock_select,
            patch("core.memory.token_buffer_memory.extract_thread_messages", return_value=[]),
        ):
            mock_stmt = MagicMock()
            mock_select.return_value.where.return_value.order_by.return_value = mock_stmt
            mock_stmt.limit.return_value = mock_stmt
            mock_db.session.scalars.return_value.all.return_value = []

            mem.get_history_prompt_messages(message_limit=9999)
            mock_stmt.limit.assert_called_with(500)

    def test_message_limit_positive_used(self):
        """A positive message_limit < 500 is used as-is."""
        mem = self._make_memory()
        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch("core.memory.token_buffer_memory.select") as mock_select,
            patch("core.memory.token_buffer_memory.extract_thread_messages", return_value=[]),
        ):
            mock_stmt = MagicMock()
            mock_select.return_value.where.return_value.order_by.return_value = mock_stmt
            mock_stmt.limit.return_value = mock_stmt
            mock_db.session.scalars.return_value.all.return_value = []

            mem.get_history_prompt_messages(message_limit=10)
            mock_stmt.limit.assert_called_with(10)

    def test_message_limit_zero_uses_default(self):
        """message_limit=0 triggers the else branch → default 500."""
        mem = self._make_memory()
        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch("core.memory.token_buffer_memory.select") as mock_select,
            patch("core.memory.token_buffer_memory.extract_thread_messages", return_value=[]),
        ):
            mock_stmt = MagicMock()
            mock_select.return_value.where.return_value.order_by.return_value = mock_stmt
            mock_stmt.limit.return_value = mock_stmt
            mock_db.session.scalars.return_value.all.return_value = []

            mem.get_history_prompt_messages(message_limit=0)
            mock_stmt.limit.assert_called_with(500)

    def test_user_files_cause_build_with_files_call(self):
        """When user_files is non-empty _build_prompt_message_with_files is invoked."""
        mem = self._make_memory()
        msg = _make_message()
        msg.parent_message_id = None

        mock_user_file = MagicMock()
        mock_user_prompt = UserPromptMessage(content="from build")
        mock_assistant_prompt = AssistantPromptMessage(content="answer")

        call_count = {"n": 0}

        def scalars_side_effect(stmt):
            r = MagicMock()
            if call_count["n"] == 0:
                # messages query
                r.all.return_value = [msg]
            elif call_count["n"] == 1:
                # user files
                r.all.return_value = [mock_user_file]
            else:
                # assistant files
                r.all.return_value = []
            call_count["n"] += 1
            return r

        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch(
                "core.memory.token_buffer_memory.extract_thread_messages",
                return_value=[msg],
            ),
            patch.object(
                mem,
                "_build_prompt_message_with_files",
                side_effect=[mock_user_prompt, mock_assistant_prompt],
            ) as mock_build,
            patch(
                "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
                return_value=None,
            ),
        ):
            mock_db.session.scalars.side_effect = scalars_side_effect
            result = mem.get_history_prompt_messages()

        assert mock_build.call_count >= 1
        # First call should be user message
        first_call_kwargs = mock_build.call_args_list[0][1]
        assert first_call_kwargs["is_user_message"] is True

    def test_assistant_files_cause_build_with_files_call(self):
        """When assistant_files is non-empty, build is called with is_user_message=False."""
        mem = self._make_memory()
        msg = _make_message()
        msg.parent_message_id = None

        mock_assistant_file = MagicMock()
        mock_user_prompt = UserPromptMessage(content="query")
        mock_assistant_prompt = AssistantPromptMessage(content="built")

        call_count = {"n": 0}

        def scalars_side_effect(stmt):
            r = MagicMock()
            if call_count["n"] == 0:
                r.all.return_value = [msg]
            elif call_count["n"] == 1:
                r.all.return_value = []  # no user files
            else:
                r.all.return_value = [mock_assistant_file]
            call_count["n"] += 1
            return r

        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch(
                "core.memory.token_buffer_memory.extract_thread_messages",
                return_value=[msg],
            ),
            patch.object(
                mem,
                "_build_prompt_message_with_files",
                return_value=mock_assistant_prompt,
            ) as mock_build,
        ):
            mock_db.session.scalars.side_effect = scalars_side_effect
            result = mem.get_history_prompt_messages()

        mock_build.assert_called_once()
        call_kwargs = mock_build.call_args[1]
        assert call_kwargs["is_user_message"] is False

    def test_token_pruning_removes_oldest_messages(self):
        """If tokens exceed limit, oldest messages are removed until within limit."""
        conv = _make_conversation()
        conv.app = MagicMock()

        # Model returns tokens that decrease only after removing pairs
        token_values = [3000, 1500]  # first call over limit, second within
        mi = MagicMock()
        mi.get_llm_num_tokens.side_effect = token_values

        mem = TokenBufferMemory(conversation=conv, model_instance=mi)

        msg = _make_message()
        msg.parent_message_id = None

        call_count = {"n": 0}

        def scalars_side_effect(stmt):
            r = MagicMock()
            if call_count["n"] == 0:
                r.all.return_value = [msg]
            else:
                r.all.return_value = []
            call_count["n"] += 1
            return r

        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch(
                "core.memory.token_buffer_memory.extract_thread_messages",
                return_value=[msg],
            ),
            patch(
                "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
                return_value=None,
            ),
        ):
            mock_db.session.scalars.side_effect = scalars_side_effect
            result = mem.get_history_prompt_messages(max_token_limit=2000)

        # After pruning, we should have fewer than the 2 initial messages
        assert len(result) <= 1

    def test_token_pruning_stops_at_single_message(self):
        """Pruning stops when only 1 message remains (to prevent empty list)."""
        conv = _make_conversation()
        conv.app = MagicMock()

        # Always over limit
        mi = MagicMock()
        mi.get_llm_num_tokens.return_value = 99999

        mem = TokenBufferMemory(conversation=conv, model_instance=mi)

        msg = _make_message()
        msg.parent_message_id = None

        call_count = {"n": 0}

        def scalars_side_effect(stmt):
            r = MagicMock()
            if call_count["n"] == 0:
                r.all.return_value = [msg]
            else:
                r.all.return_value = []
            call_count["n"] += 1
            return r

        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch(
                "core.memory.token_buffer_memory.extract_thread_messages",
                return_value=[msg],
            ),
            patch(
                "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
                return_value=None,
            ),
        ):
            mock_db.session.scalars.side_effect = scalars_side_effect
            result = mem.get_history_prompt_messages(max_token_limit=1)

        # At least 1 message should remain
        assert len(result) >= 1

    def test_no_pruning_when_within_limit(self):
        """When tokens ≤ limit, no pruning occurs."""
        mem = self._make_memory()
        mem.model_instance.get_llm_num_tokens.return_value = 50  # well under default 2000

        msg = _make_message()
        msg.parent_message_id = None

        call_count = {"n": 0}

        def scalars_side_effect(stmt):
            r = MagicMock()
            if call_count["n"] == 0:
                r.all.return_value = [msg]
            else:
                r.all.return_value = []
            call_count["n"] += 1
            return r

        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch(
                "core.memory.token_buffer_memory.extract_thread_messages",
                return_value=[msg],
            ),
            patch(
                "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
                return_value=None,
            ),
        ):
            mock_db.session.scalars.side_effect = scalars_side_effect
            result = mem.get_history_prompt_messages(max_token_limit=2000)

        assert len(result) == 2  # user + assistant

    def test_plain_user_and_assistant_messages_returned(self):
        """Without files, plain UserPromptMessage and AssistantPromptMessage appear."""
        mem = self._make_memory()

        msg = _make_message(answer="My answer")
        msg.query = "My query"
        msg.parent_message_id = None

        call_count = {"n": 0}

        def scalars_side_effect(stmt):
            r = MagicMock()
            if call_count["n"] == 0:
                r.all.return_value = [msg]
            else:
                r.all.return_value = []
            call_count["n"] += 1
            return r

        with (
            patch("core.memory.token_buffer_memory.db") as mock_db,
            patch(
                "core.memory.token_buffer_memory.extract_thread_messages",
                return_value=[msg],
            ),
            patch(
                "core.memory.token_buffer_memory.FileUploadConfigManager.convert",
                return_value=None,
            ),
        ):
            mock_db.session.scalars.side_effect = scalars_side_effect
            result = mem.get_history_prompt_messages()

        assert len(result) == 2
        user_msg, ai_msg = result
        assert isinstance(user_msg, UserPromptMessage)
        assert user_msg.content == "My query"
        assert isinstance(ai_msg, AssistantPromptMessage)
        assert ai_msg.content == "My answer"


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
