"""Tests for AgentAppRunner."""

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from core.agent.entities import AgentEntity, AgentLog, AgentPromptEntity, AgentResult
from core.model_runtime.entities import SystemPromptMessage, UserPromptMessage
from core.model_runtime.entities.llm_entities import LLMUsage


class TestOrganizePromptMessages:
    """Tests for _organize_prompt_messages method."""

    @pytest.fixture
    def mock_runner(self):
        """Create a mock AgentAppRunner for testing."""
        # We'll patch the class to avoid complex initialization
        with patch("core.agent.agent_app_runner.BaseAgentRunner.__init__", return_value=None):
            from core.agent.agent_app_runner import AgentAppRunner

            runner = AgentAppRunner.__new__(AgentAppRunner)

            # Set up required attributes
            runner.config = MagicMock(spec=AgentEntity)
            runner.config.strategy = AgentEntity.Strategy.FUNCTION_CALLING
            runner.config.prompt = None

            runner.app_config = MagicMock()
            runner.app_config.prompt_template = MagicMock()
            runner.app_config.prompt_template.simple_prompt_template = "You are a helpful assistant."

            runner.history_prompt_messages = []
            runner.query = "Hello"
            runner._current_thoughts = []
            runner.files = []
            runner.model_config = MagicMock()
            runner.memory = None
            runner.application_generate_entity = MagicMock()
            runner.application_generate_entity.file_upload_config = None

            return runner

    def test_function_calling_uses_simple_prompt(self, mock_runner):
        """Test that function calling strategy uses simple_prompt_template."""
        mock_runner.config.strategy = AgentEntity.Strategy.FUNCTION_CALLING

        with patch.object(mock_runner, "_init_system_message") as mock_init:
            mock_init.return_value = [SystemPromptMessage(content="You are a helpful assistant.")]
            with patch.object(mock_runner, "_organize_user_query") as mock_query:
                mock_query.return_value = [UserPromptMessage(content="Hello")]
                with patch("core.agent.agent_app_runner.AgentHistoryPromptTransform") as mock_transform:
                    mock_transform.return_value.get_prompt.return_value = [
                        SystemPromptMessage(content="You are a helpful assistant.")
                    ]

                    result = mock_runner._organize_prompt_messages()

                    # Verify _init_system_message was called with simple_prompt_template
                    mock_init.assert_called_once()
                    call_args = mock_init.call_args[0]
                    assert call_args[0] == "You are a helpful assistant."

    def test_chain_of_thought_uses_agent_prompt(self, mock_runner):
        """Test that chain of thought strategy uses agent prompt template."""
        mock_runner.config.strategy = AgentEntity.Strategy.CHAIN_OF_THOUGHT
        mock_runner.config.prompt = AgentPromptEntity(
            first_prompt="ReAct prompt template with {{tools}}",
            next_iteration="Continue...",
        )

        with patch.object(mock_runner, "_init_system_message") as mock_init:
            mock_init.return_value = [SystemPromptMessage(content="ReAct prompt template with {{tools}}")]
            with patch.object(mock_runner, "_organize_user_query") as mock_query:
                mock_query.return_value = [UserPromptMessage(content="Hello")]
                with patch("core.agent.agent_app_runner.AgentHistoryPromptTransform") as mock_transform:
                    mock_transform.return_value.get_prompt.return_value = [
                        SystemPromptMessage(content="ReAct prompt template with {{tools}}")
                    ]

                    result = mock_runner._organize_prompt_messages()

                    # Verify _init_system_message was called with agent prompt
                    mock_init.assert_called_once()
                    call_args = mock_init.call_args[0]
                    assert call_args[0] == "ReAct prompt template with {{tools}}"

    def test_chain_of_thought_without_prompt_falls_back(self, mock_runner):
        """Test that chain of thought without prompt falls back to simple_prompt_template."""
        mock_runner.config.strategy = AgentEntity.Strategy.CHAIN_OF_THOUGHT
        mock_runner.config.prompt = None

        with patch.object(mock_runner, "_init_system_message") as mock_init:
            mock_init.return_value = [SystemPromptMessage(content="You are a helpful assistant.")]
            with patch.object(mock_runner, "_organize_user_query") as mock_query:
                mock_query.return_value = [UserPromptMessage(content="Hello")]
                with patch("core.agent.agent_app_runner.AgentHistoryPromptTransform") as mock_transform:
                    mock_transform.return_value.get_prompt.return_value = [
                        SystemPromptMessage(content="You are a helpful assistant.")
                    ]

                    result = mock_runner._organize_prompt_messages()

                    # Verify _init_system_message was called with simple_prompt_template
                    mock_init.assert_called_once()
                    call_args = mock_init.call_args[0]
                    assert call_args[0] == "You are a helpful assistant."


class TestInitSystemMessage:
    """Tests for _init_system_message method."""

    @pytest.fixture
    def mock_runner(self):
        """Create a mock AgentAppRunner for testing."""
        with patch("core.agent.agent_app_runner.BaseAgentRunner.__init__", return_value=None):
            from core.agent.agent_app_runner import AgentAppRunner

            runner = AgentAppRunner.__new__(AgentAppRunner)
            return runner

    def test_empty_messages_with_template(self, mock_runner):
        """Test that system message is created when messages are empty."""
        result = mock_runner._init_system_message("System template", [])

        assert len(result) == 1
        assert isinstance(result[0], SystemPromptMessage)
        assert result[0].content == "System template"

    def test_empty_messages_without_template(self, mock_runner):
        """Test that empty list is returned when no template and no messages."""
        result = mock_runner._init_system_message("", [])

        assert result == []

    def test_existing_system_message_not_duplicated(self, mock_runner):
        """Test that system message is not duplicated if already present."""
        existing_messages = [
            SystemPromptMessage(content="Existing system"),
            UserPromptMessage(content="User message"),
        ]

        result = mock_runner._init_system_message("New template", existing_messages)

        # Should not insert new system message
        assert len(result) == 2
        assert result[0].content == "Existing system"

    def test_system_message_inserted_when_missing(self, mock_runner):
        """Test that system message is inserted when first message is not system."""
        existing_messages = [
            UserPromptMessage(content="User message"),
        ]

        result = mock_runner._init_system_message("System template", existing_messages)

        assert len(result) == 2
        assert isinstance(result[0], SystemPromptMessage)
        assert result[0].content == "System template"


class TestClearUserPromptImageMessages:
    """Tests for _clear_user_prompt_image_messages method."""

    @pytest.fixture
    def mock_runner(self):
        """Create a mock AgentAppRunner for testing."""
        with patch("core.agent.agent_app_runner.BaseAgentRunner.__init__", return_value=None):
            from core.agent.agent_app_runner import AgentAppRunner

            runner = AgentAppRunner.__new__(AgentAppRunner)
            return runner

    def test_text_content_unchanged(self, mock_runner):
        """Test that text content is unchanged."""
        messages = [
            UserPromptMessage(content="Plain text message"),
        ]

        result = mock_runner._clear_user_prompt_image_messages(messages)

        assert len(result) == 1
        assert result[0].content == "Plain text message"

    def test_original_messages_not_modified(self, mock_runner):
        """Test that original messages are not modified (deep copy)."""
        from core.model_runtime.entities.message_entities import (
            ImagePromptMessageContent,
            TextPromptMessageContent,
        )

        messages = [
            UserPromptMessage(
                content=[
                    TextPromptMessageContent(data="Text part"),
                    ImagePromptMessageContent(
                        data="http://example.com/image.jpg",
                        format="url",
                        mime_type="image/jpeg",
                    ),
                ]
            ),
        ]

        result = mock_runner._clear_user_prompt_image_messages(messages)

        # Original should still have list content
        assert isinstance(messages[0].content, list)
        # Result should have string content
        assert isinstance(result[0].content, str)


class TestToolInvokeHook:
    """Tests for _create_tool_invoke_hook method."""

    @pytest.fixture
    def mock_runner(self):
        """Create a mock AgentAppRunner for testing."""
        with patch("core.agent.agent_app_runner.BaseAgentRunner.__init__", return_value=None):
            from core.agent.agent_app_runner import AgentAppRunner

            runner = AgentAppRunner.__new__(AgentAppRunner)

            runner.user_id = "test-user"
            runner.tenant_id = "test-tenant"
            runner.application_generate_entity = MagicMock()
            runner.application_generate_entity.trace_manager = None
            runner.application_generate_entity.invoke_from = "api"
            runner.application_generate_entity.app_config = MagicMock()
            runner.application_generate_entity.app_config.app_id = "test-app"
            runner.agent_callback = MagicMock()
            runner.conversation = MagicMock()
            runner.conversation.id = "test-conversation"
            runner.queue_manager = MagicMock()
            runner._current_message_file_ids = []

            return runner

    def test_hook_calls_agent_invoke(self, mock_runner):
        """Test that the hook calls ToolEngine.agent_invoke."""
        from core.tools.entities.tool_entities import ToolInvokeMeta

        mock_message = MagicMock()
        mock_message.id = "test-message"

        mock_tool = MagicMock()
        mock_tool_meta = ToolInvokeMeta(
            time_cost=0.5,
            error=None,
            tool_config={
                "tool_provider_type": "test_provider",
                "tool_provider": "test_id",
            },
        )

        with patch("core.agent.agent_app_runner.ToolEngine") as mock_engine:
            mock_engine.agent_invoke.return_value = ("Tool result", ["file-1", "file-2"], mock_tool_meta)

            hook = mock_runner._create_tool_invoke_hook(mock_message)
            result_content, result_files, result_meta = hook(mock_tool, {"arg": "value"}, "test_tool")

            # Verify ToolEngine.agent_invoke was called
            mock_engine.agent_invoke.assert_called_once()

            # Verify return values
            assert result_content == "Tool result"
            assert result_files == ["file-1", "file-2"]
            assert result_meta == mock_tool_meta

    def test_hook_publishes_file_events(self, mock_runner):
        """Test that the hook publishes QueueMessageFileEvent for files."""
        from core.tools.entities.tool_entities import ToolInvokeMeta

        mock_message = MagicMock()
        mock_message.id = "test-message"

        mock_tool = MagicMock()
        mock_tool_meta = ToolInvokeMeta(
            time_cost=0.5,
            error=None,
            tool_config={},
        )

        with patch("core.agent.agent_app_runner.ToolEngine") as mock_engine:
            mock_engine.agent_invoke.return_value = ("Tool result", ["file-1", "file-2"], mock_tool_meta)

            hook = mock_runner._create_tool_invoke_hook(mock_message)
            hook(mock_tool, {}, "test_tool")

            # Verify file events were published
            assert mock_runner.queue_manager.publish.call_count == 2
            assert mock_runner._current_message_file_ids == ["file-1", "file-2"]


class TestAgentLogProcessing:
    """Tests for AgentLog processing in run method."""

    def test_agent_log_status_enum(self):
        """Test AgentLog status enum values."""
        assert AgentLog.LogStatus.START == "start"
        assert AgentLog.LogStatus.SUCCESS == "success"
        assert AgentLog.LogStatus.ERROR == "error"

    def test_agent_log_metadata_enum(self):
        """Test AgentLog metadata enum values."""
        assert AgentLog.LogMetadata.STARTED_AT == "started_at"
        assert AgentLog.LogMetadata.FINISHED_AT == "finished_at"
        assert AgentLog.LogMetadata.ELAPSED_TIME == "elapsed_time"
        assert AgentLog.LogMetadata.TOTAL_PRICE == "total_price"
        assert AgentLog.LogMetadata.TOTAL_TOKENS == "total_tokens"
        assert AgentLog.LogMetadata.LLM_USAGE == "llm_usage"

    def test_agent_result_structure(self):
        """Test AgentResult structure."""
        usage = LLMUsage(
            prompt_tokens=100,
            prompt_unit_price=Decimal("0.001"),
            prompt_price_unit=Decimal("0.001"),
            prompt_price=Decimal("0.1"),
            completion_tokens=50,
            completion_unit_price=Decimal("0.002"),
            completion_price_unit=Decimal("0.001"),
            completion_price=Decimal("0.1"),
            total_tokens=150,
            total_price=Decimal("0.2"),
            currency="USD",
            latency=0.5,
        )

        result = AgentResult(
            text="Final answer",
            files=[],
            usage=usage,
            finish_reason="stop",
        )

        assert result.text == "Final answer"
        assert result.files == []
        assert result.usage == usage
        assert result.finish_reason == "stop"


class TestOrganizeUserQuery:
    """Tests for _organize_user_query method."""

    @pytest.fixture
    def mock_runner(self):
        """Create a mock AgentAppRunner for testing."""
        with patch("core.agent.agent_app_runner.BaseAgentRunner.__init__", return_value=None):
            from core.agent.agent_app_runner import AgentAppRunner

            runner = AgentAppRunner.__new__(AgentAppRunner)
            runner.files = []
            runner.application_generate_entity = MagicMock()
            runner.application_generate_entity.file_upload_config = None
            return runner

    def test_simple_query_without_files(self, mock_runner):
        """Test organizing a simple query without files."""
        result = mock_runner._organize_user_query("Hello world", [])

        assert len(result) == 1
        assert isinstance(result[0], UserPromptMessage)
        assert result[0].content == "Hello world"

    def test_query_with_files(self, mock_runner):
        """Test organizing a query with files."""
        from core.file.models import File

        mock_file = MagicMock(spec=File)
        mock_runner.files = [mock_file]

        with patch("core.agent.agent_app_runner.file_manager") as mock_fm:
            from core.model_runtime.entities.message_entities import ImagePromptMessageContent

            mock_fm.to_prompt_message_content.return_value = ImagePromptMessageContent(
                data="http://example.com/image.jpg",
                format="url",
                mime_type="image/jpeg",
            )

            result = mock_runner._organize_user_query("Describe this image", [])

            assert len(result) == 1
            assert isinstance(result[0], UserPromptMessage)
            assert isinstance(result[0].content, list)
            assert len(result[0].content) == 2  # Image + Text
