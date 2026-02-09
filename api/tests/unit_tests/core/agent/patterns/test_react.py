"""Tests for ReActStrategy."""

from unittest.mock import MagicMock

import pytest

from core.agent.entities import ExecutionContext
from core.agent.patterns.react import ReActStrategy
from core.model_runtime.entities import SystemPromptMessage, UserPromptMessage


@pytest.fixture
def mock_model_instance():
    """Create a mock model instance."""
    model_instance = MagicMock()
    model_instance.model = "test-model"
    model_instance.provider = "test-provider"
    return model_instance


@pytest.fixture
def mock_context():
    """Create a mock execution context."""
    return ExecutionContext(
        user_id="test-user",
        app_id="test-app",
        conversation_id="test-conversation",
        message_id="test-message",
        tenant_id="test-tenant",
    )


@pytest.fixture
def mock_tool():
    """Create a mock tool."""
    from core.model_runtime.entities.message_entities import PromptMessageTool

    tool = MagicMock()
    tool.entity.identity.name = "test_tool"
    tool.entity.identity.provider = "test_provider"

    # Use real PromptMessageTool for proper serialization
    prompt_tool = PromptMessageTool(
        name="test_tool",
        description="A test tool",
        parameters={"type": "object", "properties": {}},
    )
    tool.to_prompt_message_tool.return_value = prompt_tool

    return tool


class TestReActStrategyInit:
    """Tests for ReActStrategy initialization."""

    def test_init_with_instruction(self, mock_model_instance, mock_context):
        """Test that instruction is stored correctly."""
        instruction = "You are a helpful assistant."

        strategy = ReActStrategy(
            model_instance=mock_model_instance,
            tools=[],
            context=mock_context,
            instruction=instruction,
        )

        assert strategy.instruction == instruction

    def test_init_with_empty_instruction(self, mock_model_instance, mock_context):
        """Test that empty instruction is handled correctly."""
        strategy = ReActStrategy(
            model_instance=mock_model_instance,
            tools=[],
            context=mock_context,
        )

        assert strategy.instruction == ""


class TestBuildPromptWithReactFormat:
    """Tests for _build_prompt_with_react_format method."""

    def test_replace_tools_placeholder(self, mock_model_instance, mock_context, mock_tool):
        """Test that {{tools}} placeholder is replaced."""
        strategy = ReActStrategy(
            model_instance=mock_model_instance,
            tools=[mock_tool],
            context=mock_context,
        )

        system_content = "You have access to: {{tools}}"
        messages = [
            SystemPromptMessage(content=system_content),
            UserPromptMessage(content="Hello"),
        ]

        result = strategy._build_prompt_with_react_format(messages, [], True)

        # The tools placeholder should be replaced with JSON
        assert "{{tools}}" not in result[0].content
        assert "test_tool" in result[0].content

    def test_replace_tool_names_placeholder(self, mock_model_instance, mock_context, mock_tool):
        """Test that {{tool_names}} placeholder is replaced."""
        strategy = ReActStrategy(
            model_instance=mock_model_instance,
            tools=[mock_tool],
            context=mock_context,
        )

        system_content = "Valid actions: {{tool_names}}"
        messages = [
            SystemPromptMessage(content=system_content),
        ]

        result = strategy._build_prompt_with_react_format(messages, [], True)

        assert "{{tool_names}}" not in result[0].content
        assert '"test_tool"' in result[0].content

    def test_replace_instruction_placeholder(self, mock_model_instance, mock_context):
        """Test that {{instruction}} placeholder is replaced."""
        instruction = "You are a helpful coding assistant."
        strategy = ReActStrategy(
            model_instance=mock_model_instance,
            tools=[],
            context=mock_context,
            instruction=instruction,
        )

        system_content = "{{instruction}}\n\nYou have access to: {{tools}}"
        messages = [
            SystemPromptMessage(content=system_content),
        ]

        result = strategy._build_prompt_with_react_format(messages, [], True, instruction)

        assert "{{instruction}}" not in result[0].content
        assert instruction in result[0].content

    def test_no_tools_available_message(self, mock_model_instance, mock_context):
        """Test that 'No tools available' is shown when include_tools is False."""
        strategy = ReActStrategy(
            model_instance=mock_model_instance,
            tools=[],
            context=mock_context,
        )

        system_content = "You have access to: {{tools}}"
        messages = [
            SystemPromptMessage(content=system_content),
        ]

        result = strategy._build_prompt_with_react_format(messages, [], False)

        assert "No tools available" in result[0].content

    def test_scratchpad_appended_as_assistant_message(self, mock_model_instance, mock_context):
        """Test that agent scratchpad is appended as AssistantPromptMessage."""
        from core.agent.entities import AgentScratchpadUnit
        from core.model_runtime.entities import AssistantPromptMessage

        strategy = ReActStrategy(
            model_instance=mock_model_instance,
            tools=[],
            context=mock_context,
        )

        messages = [
            SystemPromptMessage(content="System prompt"),
            UserPromptMessage(content="User query"),
        ]

        scratchpad = [
            AgentScratchpadUnit(
                thought="I need to search for information",
                action_str='{"action": "search", "action_input": "query"}',
                observation="Search results here",
            )
        ]

        result = strategy._build_prompt_with_react_format(messages, scratchpad, True)

        # The last message should be an AssistantPromptMessage with scratchpad content
        assert len(result) == 3
        assert isinstance(result[-1], AssistantPromptMessage)
        assert "I need to search for information" in result[-1].content
        assert "Search results here" in result[-1].content

    def test_empty_scratchpad_no_extra_message(self, mock_model_instance, mock_context):
        """Test that empty scratchpad doesn't add extra message."""
        strategy = ReActStrategy(
            model_instance=mock_model_instance,
            tools=[],
            context=mock_context,
        )

        messages = [
            SystemPromptMessage(content="System prompt"),
            UserPromptMessage(content="User query"),
        ]

        result = strategy._build_prompt_with_react_format(messages, [], True)

        # Should only have the original 2 messages
        assert len(result) == 2

    def test_original_messages_not_modified(self, mock_model_instance, mock_context):
        """Test that original messages list is not modified."""
        strategy = ReActStrategy(
            model_instance=mock_model_instance,
            tools=[],
            context=mock_context,
        )

        original_content = "Original system prompt {{tools}}"
        messages = [
            SystemPromptMessage(content=original_content),
        ]

        strategy._build_prompt_with_react_format(messages, [], True)

        # Original message should not be modified
        assert messages[0].content == original_content
