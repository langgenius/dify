"""
Unit tests for TokenBufferMemory._build_prompt_message_with_files.

Regression tests for https://github.com/langgenius/dify/issues/32674:
After workflow runs cleanup, messages with workflow_run_id still exist but the
referenced WorkflowRun/Workflow rows are gone.  The old code raised ValueError,
crashing get_history_prompt_messages.  The fix degrades gracefully to text-only
prompt messages.
"""

from unittest.mock import MagicMock, Mock, patch

import pytest

from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities import AssistantPromptMessage, UserPromptMessage
from models.model import AppMode


@pytest.fixture
def mock_conversation():
    """Create a mock conversation in ADVANCED_CHAT mode."""
    conversation = Mock()
    conversation.mode = AppMode.ADVANCED_CHAT
    conversation.app = Mock()
    conversation.app.tenant_id = "tenant-1"
    conversation.app.id = "app-1"
    return conversation


@pytest.fixture
def mock_model_instance():
    return Mock()


@pytest.fixture
def memory(mock_conversation, mock_model_instance):
    return TokenBufferMemory(conversation=mock_conversation, model_instance=mock_model_instance)


@pytest.fixture
def mock_message_with_workflow_run():
    """Message whose workflow run still exists."""
    msg = Mock()
    msg.id = "msg-1"
    msg.workflow_run_id = "wr-1"
    return msg


@pytest.fixture
def mock_message_without_workflow_run():
    """Message whose workflow_run_id is None."""
    msg = Mock()
    msg.id = "msg-2"
    msg.workflow_run_id = None
    return msg


class TestBuildPromptMessageWithDeletedWorkflowRun:
    """Verify graceful degradation when workflow run or workflow is missing."""

    def test_missing_workflow_run_returns_text_only_user_message(
        self,
        memory,
        mock_message_with_workflow_run,
    ):
        """When workflow run is deleted, return plain text UserPromptMessage."""
        mock_repo = MagicMock()
        mock_repo.get_workflow_run_by_id.return_value = None
        memory._workflow_run_repo = mock_repo

        result = memory._build_prompt_message_with_files(
            message_files=[Mock()],
            text_content="hello",
            message=mock_message_with_workflow_run,
            app_record=Mock(),
            is_user_message=True,
        )

        assert isinstance(result, UserPromptMessage)
        assert result.content == "hello"

    def test_missing_workflow_run_returns_text_only_assistant_message(
        self,
        memory,
        mock_message_with_workflow_run,
    ):
        """When workflow run is deleted, return plain text AssistantPromptMessage."""
        mock_repo = MagicMock()
        mock_repo.get_workflow_run_by_id.return_value = None
        memory._workflow_run_repo = mock_repo

        result = memory._build_prompt_message_with_files(
            message_files=[Mock()],
            text_content="answer",
            message=mock_message_with_workflow_run,
            app_record=Mock(),
            is_user_message=False,
        )

        assert isinstance(result, AssistantPromptMessage)
        assert result.content == "answer"

    @patch("core.memory.token_buffer_memory.db")
    def test_missing_workflow_returns_text_only(
        self,
        mock_db,
        memory,
        mock_message_with_workflow_run,
    ):
        """When workflow is deleted but workflow run exists, return plain text."""
        mock_workflow_run = Mock()
        mock_workflow_run.workflow_id = "wf-1"

        mock_repo = MagicMock()
        mock_repo.get_workflow_run_by_id.return_value = mock_workflow_run
        memory._workflow_run_repo = mock_repo

        # Workflow lookup returns None
        mock_db.session.scalar.return_value = None

        result = memory._build_prompt_message_with_files(
            message_files=[Mock()],
            text_content="hello",
            message=mock_message_with_workflow_run,
            app_record=Mock(),
            is_user_message=True,
        )

        assert isinstance(result, UserPromptMessage)
        assert result.content == "hello"

    def test_no_workflow_run_id_returns_text_only(
        self,
        memory,
        mock_message_without_workflow_run,
    ):
        """When message.workflow_run_id is None, return plain text."""
        result = memory._build_prompt_message_with_files(
            message_files=[Mock()],
            text_content="hello",
            message=mock_message_without_workflow_run,
            app_record=Mock(),
            is_user_message=True,
        )

        assert isinstance(result, UserPromptMessage)
        assert result.content == "hello"

    @patch("core.memory.token_buffer_memory.db")
    @patch("core.memory.token_buffer_memory.FileUploadConfigManager")
    @patch("core.memory.token_buffer_memory.file_factory")
    def test_valid_workflow_run_processes_files(
        self,
        mock_file_factory,
        mock_config_manager,
        mock_db,
        memory,
        mock_message_with_workflow_run,
    ):
        """When workflow run and workflow exist, file processing proceeds normally."""
        mock_workflow_run = Mock()
        mock_workflow_run.workflow_id = "wf-1"

        mock_repo = MagicMock()
        mock_repo.get_workflow_run_by_id.return_value = mock_workflow_run
        memory._workflow_run_repo = mock_repo

        mock_workflow = Mock()
        mock_workflow.features_dict = {}
        mock_db.session.scalar.return_value = mock_workflow

        mock_file_config = Mock()
        mock_file_config.image_config = None
        mock_config_manager.convert.return_value = mock_file_config

        # file_factory returns empty file objects (no actual images)
        mock_file_factory.build_from_message_file.return_value = Mock()

        result = memory._build_prompt_message_with_files(
            message_files=[Mock()],
            text_content="hello",
            message=mock_message_with_workflow_run,
            app_record=Mock(),
            is_user_message=True,
        )

        # Should process files and call FileUploadConfigManager
        mock_config_manager.convert.assert_called_once()
        # Result should be a UserPromptMessage (with file content list)
        assert isinstance(result, UserPromptMessage)
