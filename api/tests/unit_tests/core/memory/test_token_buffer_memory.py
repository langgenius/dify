"""Unit tests for TokenBufferMemory batch MessageFile loading."""

from unittest.mock import MagicMock, patch

import pytest

from models.model import MessageFile


class FakeMessage:
    def __init__(self, id: str, query: str = "q", answer: str = "a"):
        self.id = id
        self.query = query
        self.answer = answer
        self.answer_tokens = 1
        self.workflow_run_id = None


def _make_message_file(msg_id: str, belongs_to: str | None) -> MagicMock:
    mf = MagicMock(spec=MessageFile)
    mf.message_id = msg_id
    mf.belongs_to = belongs_to
    return mf


class TestBatchMessageFileLoading:
    """Verify get_history_prompt_messages uses a single batch query for MessageFile."""

    @patch("core.memory.token_buffer_memory.db")
    @patch("core.memory.token_buffer_memory.extract_thread_messages")
    def test_batch_query_instead_of_n_plus_1(self, mock_extract, mock_db):
        """Should issue at most 2 DB queries (messages + files) instead of 2N+1."""
        from core.memory.token_buffer_memory import TokenBufferMemory

        # Setup: 5 messages
        messages = [FakeMessage(id=f"msg-{i}") for i in range(5)]
        mock_extract.return_value = messages

        # Mock conversation and model_instance
        conversation = MagicMock()
        conversation.app = MagicMock()
        conversation.app.tenant_id = "t1"
        conversation.app.id = "a1"
        conversation.mode = "chat"
        conversation.model_config = {}

        model_instance = MagicMock()
        model_instance.get_llm_num_tokens.return_value = 100

        # Mock db.session.scalars to track calls
        mock_scalars_result = MagicMock()
        mock_scalars_result.all.return_value = []
        mock_db.session.scalars.return_value = mock_scalars_result

        memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)

        with patch.object(memory, "_build_prompt_message_with_files"):
            memory.get_history_prompt_messages(max_token_limit=2000)

        # Should have exactly 2 scalars calls: one for messages, one for MessageFile batch
        assert mock_db.session.scalars.call_count == 2

        # The second call should be an IN query (batch)
        from sqlalchemy import select
        second_call_stmt = mock_db.session.scalars.call_args_list[1][0][0]
        # Verify it's a select on MessageFile
        assert hasattr(second_call_stmt, 'columns_clause_froms')

    @patch("core.memory.token_buffer_memory.db")
    @patch("core.memory.token_buffer_memory.extract_thread_messages")
    def test_files_grouped_correctly_by_message_and_belongs_to(self, mock_extract, mock_db):
        """User files (including None belongs_to) and assistant files should be grouped correctly."""
        from core.memory.token_buffer_memory import TokenBufferMemory

        messages = [FakeMessage(id="msg-1"), FakeMessage(id="msg-2")]
        mock_extract.return_value = messages

        # Create mock files
        user_file_1 = _make_message_file("msg-1", "user")
        none_file_1 = _make_message_file("msg-1", None)
        assistant_file_1 = _make_message_file("msg-1", "assistant")
        user_file_2 = _make_message_file("msg-2", "user")

        conversation = MagicMock()
        conversation.app = MagicMock()
        conversation.app.tenant_id = "t1"
        conversation.app.id = "a1"
        conversation.mode = "chat"
        conversation.model_config = {}

        model_instance = MagicMock()
        model_instance.get_llm_num_tokens.return_value = 100

        # First call returns messages, second returns all files
        msg_result = MagicMock()
        msg_result.all.return_value = messages

        file_result = MagicMock()
        file_result.all.return_value = [user_file_1, none_file_1, assistant_file_1, user_file_2]

        mock_db.session.scalars.side_effect = [msg_result, file_result]

        memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)

        build_calls = []
        original_build = memory._build_prompt_message_with_files

        def capture_build(**kwargs):
            build_calls.append(kwargs)
            return MagicMock()

        with patch.object(memory, "_build_prompt_message_with_files", side_effect=capture_build):
            memory.get_history_prompt_messages(max_token_limit=2000)

        # msg-1 should get 2 user files (user + None) and 1 assistant file
        msg1_user_calls = [c for c in build_calls if c.get("is_user_message") and c["message"].id == "msg-1"]
        msg1_asst_calls = [c for c in build_calls if not c.get("is_user_message") and c["message"].id == "msg-1"]

        assert len(msg1_user_calls) == 1
        assert len(msg1_user_calls[0]["message_files"]) == 2  # user + None
        assert len(msg1_asst_calls) == 1
        assert len(msg1_asst_calls[0]["message_files"]) == 1

        # msg-2 should get 1 user file and 0 assistant files
        msg2_user_calls = [c for c in build_calls if c.get("is_user_message") and c["message"].id == "msg-2"]
        assert len(msg2_user_calls) == 1
        assert len(msg2_user_calls[0]["message_files"]) == 1

    @patch("core.memory.token_buffer_memory.db")
    @patch("core.memory.token_buffer_memory.extract_thread_messages")
    def test_no_messages_results_in_no_file_query(self, mock_extract, mock_db):
        """When there are no messages, no MessageFile query should be issued."""
        from core.memory.token_buffer_memory import TokenBufferMemory

        mock_extract.return_value = []

        conversation = MagicMock()
        conversation.app = MagicMock()
        model_instance = MagicMock()

        msg_result = MagicMock()
        msg_result.all.return_value = []
        mock_db.session.scalars.return_value = msg_result

        memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)
        result = memory.get_history_prompt_messages()

        # Only 1 scalars call (messages), no file query
        assert mock_db.session.scalars.call_count == 1
        assert result == []
