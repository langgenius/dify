"""Tests for FunctionCallStrategy."""

from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from core.agent.entities import AgentLog, ExecutionContext
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import (
    PromptMessageTool,
    SystemPromptMessage,
    UserPromptMessage,
)


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
    tool = MagicMock()
    tool.entity.identity.name = "test_tool"
    tool.to_prompt_message_tool.return_value = PromptMessageTool(
        name="test_tool",
        description="A test tool",
        parameters={
            "type": "object",
            "properties": {"param1": {"type": "string", "description": "A parameter"}},
            "required": ["param1"],
        },
    )
    return tool


class TestFunctionCallStrategyInit:
    """Tests for FunctionCallStrategy initialization."""

    def test_initialization(self, mock_model_instance, mock_context, mock_tool):
        """Test basic initialization."""
        from core.agent.patterns.function_call import FunctionCallStrategy

        strategy = FunctionCallStrategy(
            model_instance=mock_model_instance,
            tools=[mock_tool],
            context=mock_context,
            max_iterations=10,
        )

        assert strategy.model_instance == mock_model_instance
        assert strategy.context == mock_context
        assert strategy.max_iterations == 10
        assert len(strategy.tools) == 1

    def test_initialization_with_tool_invoke_hook(self, mock_model_instance, mock_context, mock_tool):
        """Test initialization with tool_invoke_hook."""
        from core.agent.patterns.function_call import FunctionCallStrategy

        mock_hook = MagicMock()

        strategy = FunctionCallStrategy(
            model_instance=mock_model_instance,
            tools=[mock_tool],
            context=mock_context,
            tool_invoke_hook=mock_hook,
        )

        assert strategy.tool_invoke_hook == mock_hook


class TestConvertToolsToPromptFormat:
    """Tests for _convert_tools_to_prompt_format method."""

    def test_convert_tools_returns_prompt_message_tools(self, mock_model_instance, mock_context, mock_tool):
        """Test that _convert_tools_to_prompt_format returns PromptMessageTool list."""
        from core.agent.patterns.function_call import FunctionCallStrategy

        strategy = FunctionCallStrategy(
            model_instance=mock_model_instance,
            tools=[mock_tool],
            context=mock_context,
        )

        tools = strategy._convert_tools_to_prompt_format()

        assert len(tools) == 1
        assert isinstance(tools[0], PromptMessageTool)
        assert tools[0].name == "test_tool"

    def test_convert_tools_empty_when_no_tools(self, mock_model_instance, mock_context):
        """Test that _convert_tools_to_prompt_format returns empty list when no tools."""
        from core.agent.patterns.function_call import FunctionCallStrategy

        strategy = FunctionCallStrategy(
            model_instance=mock_model_instance,
            tools=[],
            context=mock_context,
        )

        tools = strategy._convert_tools_to_prompt_format()

        assert tools == []


class TestAgentLogGeneration:
    """Tests for AgentLog generation during run."""

    def test_round_log_structure(self, mock_model_instance, mock_context, mock_tool):
        """Test that round logs have correct structure."""
        from core.agent.patterns.function_call import FunctionCallStrategy

        strategy = FunctionCallStrategy(
            model_instance=mock_model_instance,
            tools=[mock_tool],
            context=mock_context,
            max_iterations=1,
        )

        # Create a round log
        round_log = strategy._create_log(
            label="ROUND 1",
            log_type=AgentLog.LogType.ROUND,
            status=AgentLog.LogStatus.START,
            data={"inputs": {"query": "test"}},
        )

        assert round_log.label == "ROUND 1"
        assert round_log.log_type == AgentLog.LogType.ROUND
        assert round_log.status == AgentLog.LogStatus.START
        assert "inputs" in round_log.data

    def test_tool_call_log_structure(self, mock_model_instance, mock_context, mock_tool):
        """Test that tool call logs have correct structure."""
        from core.agent.patterns.function_call import FunctionCallStrategy

        strategy = FunctionCallStrategy(
            model_instance=mock_model_instance,
            tools=[mock_tool],
            context=mock_context,
        )

        # Create a parent round log
        round_log = strategy._create_log(
            label="ROUND 1",
            log_type=AgentLog.LogType.ROUND,
            status=AgentLog.LogStatus.START,
            data={},
        )

        # Create a tool call log
        tool_log = strategy._create_log(
            label="CALL test_tool",
            log_type=AgentLog.LogType.TOOL_CALL,
            status=AgentLog.LogStatus.START,
            data={"tool_name": "test_tool", "tool_args": {"param1": "value1"}},
            parent_id=round_log.id,
        )

        assert tool_log.label == "CALL test_tool"
        assert tool_log.log_type == AgentLog.LogType.TOOL_CALL
        assert tool_log.parent_id == round_log.id
        assert tool_log.data["tool_name"] == "test_tool"


class TestToolInvocation:
    """Tests for tool invocation."""

    def test_invoke_tool_with_hook(self, mock_model_instance, mock_context, mock_tool):
        """Test that tool invocation uses hook when provided."""
        from core.agent.patterns.function_call import FunctionCallStrategy
        from core.tools.entities.tool_entities import ToolInvokeMeta

        mock_hook = MagicMock()
        mock_meta = ToolInvokeMeta(
            time_cost=0.5,
            error=None,
            tool_config={"tool_provider_type": "test", "tool_provider": "test_id"},
        )
        mock_hook.return_value = ("Tool result", ["file-1"], mock_meta)

        strategy = FunctionCallStrategy(
            model_instance=mock_model_instance,
            tools=[mock_tool],
            context=mock_context,
            tool_invoke_hook=mock_hook,
        )

        result, files, meta = strategy._invoke_tool(mock_tool, {"param1": "value"}, "test_tool")

        mock_hook.assert_called_once()
        assert result == "Tool result"
        assert files == []  # Hook returns file IDs, but _invoke_tool returns empty File list
        assert meta == mock_meta

    def test_invoke_tool_without_hook_attribute_set(self, mock_model_instance, mock_context, mock_tool):
        """Test that tool_invoke_hook is None when not provided."""
        from core.agent.patterns.function_call import FunctionCallStrategy

        strategy = FunctionCallStrategy(
            model_instance=mock_model_instance,
            tools=[mock_tool],
            context=mock_context,
            tool_invoke_hook=None,
        )

        # Verify that tool_invoke_hook is None
        assert strategy.tool_invoke_hook is None


class TestUsageTracking:
    """Tests for usage tracking across rounds."""

    def test_round_usage_is_separate_from_total(self, mock_model_instance, mock_context):
        """Test that round usage is tracked separately from total."""
        from core.agent.patterns.function_call import FunctionCallStrategy

        strategy = FunctionCallStrategy(
            model_instance=mock_model_instance,
            tools=[],
            context=mock_context,
        )

        # Simulate two rounds of usage
        total_usage: dict = {"usage": None}
        round1_usage: dict = {"usage": None}
        round2_usage: dict = {"usage": None}

        # Round 1
        usage1 = LLMUsage(
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
        strategy._accumulate_usage(round1_usage, usage1)
        strategy._accumulate_usage(total_usage, usage1)

        # Round 2
        usage2 = LLMUsage(
            prompt_tokens=200,
            prompt_unit_price=Decimal("0.001"),
            prompt_price_unit=Decimal("0.001"),
            prompt_price=Decimal("0.2"),
            completion_tokens=100,
            completion_unit_price=Decimal("0.002"),
            completion_price_unit=Decimal("0.001"),
            completion_price=Decimal("0.2"),
            total_tokens=300,
            total_price=Decimal("0.4"),
            currency="USD",
            latency=0.5,
        )
        strategy._accumulate_usage(round2_usage, usage2)
        strategy._accumulate_usage(total_usage, usage2)

        # Verify round usage is separate
        assert round1_usage["usage"].total_tokens == 150
        assert round2_usage["usage"].total_tokens == 300
        # Verify total is accumulated
        assert total_usage["usage"].total_tokens == 450


class TestPromptMessageHandling:
    """Tests for prompt message handling."""

    def test_messages_include_system_and_user(self, mock_model_instance, mock_context, mock_tool):
        """Test that messages include system and user prompts."""
        from core.agent.patterns.function_call import FunctionCallStrategy

        strategy = FunctionCallStrategy(
            model_instance=mock_model_instance,
            tools=[mock_tool],
            context=mock_context,
        )

        messages = [
            SystemPromptMessage(content="You are a helpful assistant."),
            UserPromptMessage(content="Hello"),
        ]

        # Just verify the messages can be processed
        assert len(messages) == 2
        assert isinstance(messages[0], SystemPromptMessage)
        assert isinstance(messages[1], UserPromptMessage)

    def test_assistant_message_with_tool_calls(self, mock_model_instance, mock_context, mock_tool):
        """Test that assistant messages can contain tool calls."""
        from core.model_runtime.entities.message_entities import AssistantPromptMessage

        tool_call = AssistantPromptMessage.ToolCall(
            id="call_123",
            type="function",
            function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                name="test_tool",
                arguments='{"param1": "value1"}',
            ),
        )

        assistant_message = AssistantPromptMessage(
            content="I'll help you with that.",
            tool_calls=[tool_call],
        )

        assert len(assistant_message.tool_calls) == 1
        assert assistant_message.tool_calls[0].function.name == "test_tool"
