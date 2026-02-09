"""Tests for StrategyFactory."""

from unittest.mock import MagicMock

import pytest

from core.agent.entities import AgentEntity, ExecutionContext
from core.agent.patterns.function_call import FunctionCallStrategy
from core.agent.patterns.react import ReActStrategy
from core.agent.patterns.strategy_factory import StrategyFactory
from core.model_runtime.entities.model_entities import ModelFeature


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


class TestStrategyFactory:
    """Tests for StrategyFactory.create_strategy method."""

    def test_create_function_call_strategy_with_tool_call_feature(self, mock_model_instance, mock_context):
        """Test that FunctionCallStrategy is created when model supports TOOL_CALL."""
        model_features = [ModelFeature.TOOL_CALL]

        strategy = StrategyFactory.create_strategy(
            model_features=model_features,
            model_instance=mock_model_instance,
            context=mock_context,
            tools=[],
            files=[],
        )

        assert isinstance(strategy, FunctionCallStrategy)

    def test_create_function_call_strategy_with_multi_tool_call_feature(self, mock_model_instance, mock_context):
        """Test that FunctionCallStrategy is created when model supports MULTI_TOOL_CALL."""
        model_features = [ModelFeature.MULTI_TOOL_CALL]

        strategy = StrategyFactory.create_strategy(
            model_features=model_features,
            model_instance=mock_model_instance,
            context=mock_context,
            tools=[],
            files=[],
        )

        assert isinstance(strategy, FunctionCallStrategy)

    def test_create_function_call_strategy_with_stream_tool_call_feature(self, mock_model_instance, mock_context):
        """Test that FunctionCallStrategy is created when model supports STREAM_TOOL_CALL."""
        model_features = [ModelFeature.STREAM_TOOL_CALL]

        strategy = StrategyFactory.create_strategy(
            model_features=model_features,
            model_instance=mock_model_instance,
            context=mock_context,
            tools=[],
            files=[],
        )

        assert isinstance(strategy, FunctionCallStrategy)

    def test_create_react_strategy_without_tool_call_features(self, mock_model_instance, mock_context):
        """Test that ReActStrategy is created when model doesn't support tool calling."""
        model_features = [ModelFeature.VISION]  # Only vision, no tool calling

        strategy = StrategyFactory.create_strategy(
            model_features=model_features,
            model_instance=mock_model_instance,
            context=mock_context,
            tools=[],
            files=[],
        )

        assert isinstance(strategy, ReActStrategy)

    def test_create_react_strategy_with_empty_features(self, mock_model_instance, mock_context):
        """Test that ReActStrategy is created when model has no features."""
        model_features: list[ModelFeature] = []

        strategy = StrategyFactory.create_strategy(
            model_features=model_features,
            model_instance=mock_model_instance,
            context=mock_context,
            tools=[],
            files=[],
        )

        assert isinstance(strategy, ReActStrategy)

    def test_explicit_function_calling_strategy_with_support(self, mock_model_instance, mock_context):
        """Test explicit FUNCTION_CALLING strategy selection with model support."""
        model_features = [ModelFeature.TOOL_CALL]

        strategy = StrategyFactory.create_strategy(
            model_features=model_features,
            model_instance=mock_model_instance,
            context=mock_context,
            tools=[],
            files=[],
            agent_strategy=AgentEntity.Strategy.FUNCTION_CALLING,
        )

        assert isinstance(strategy, FunctionCallStrategy)

    def test_explicit_function_calling_strategy_without_support_falls_back_to_react(
        self, mock_model_instance, mock_context
    ):
        """Test that explicit FUNCTION_CALLING falls back to ReAct when not supported."""
        model_features: list[ModelFeature] = []  # No tool calling support

        strategy = StrategyFactory.create_strategy(
            model_features=model_features,
            model_instance=mock_model_instance,
            context=mock_context,
            tools=[],
            files=[],
            agent_strategy=AgentEntity.Strategy.FUNCTION_CALLING,
        )

        # Should fall back to ReAct since FC is not supported
        assert isinstance(strategy, ReActStrategy)

    def test_explicit_chain_of_thought_strategy(self, mock_model_instance, mock_context):
        """Test explicit CHAIN_OF_THOUGHT strategy selection."""
        model_features = [ModelFeature.TOOL_CALL]  # Even with tool call support

        strategy = StrategyFactory.create_strategy(
            model_features=model_features,
            model_instance=mock_model_instance,
            context=mock_context,
            tools=[],
            files=[],
            agent_strategy=AgentEntity.Strategy.CHAIN_OF_THOUGHT,
        )

        assert isinstance(strategy, ReActStrategy)

    def test_react_strategy_with_instruction(self, mock_model_instance, mock_context):
        """Test that ReActStrategy receives instruction parameter."""
        model_features: list[ModelFeature] = []
        instruction = "You are a helpful assistant."

        strategy = StrategyFactory.create_strategy(
            model_features=model_features,
            model_instance=mock_model_instance,
            context=mock_context,
            tools=[],
            files=[],
            instruction=instruction,
        )

        assert isinstance(strategy, ReActStrategy)
        assert strategy.instruction == instruction

    def test_max_iterations_passed_to_strategy(self, mock_model_instance, mock_context):
        """Test that max_iterations is passed to the strategy."""
        model_features = [ModelFeature.TOOL_CALL]
        max_iterations = 5

        strategy = StrategyFactory.create_strategy(
            model_features=model_features,
            model_instance=mock_model_instance,
            context=mock_context,
            tools=[],
            files=[],
            max_iterations=max_iterations,
        )

        assert strategy.max_iterations == max_iterations

    def test_tool_invoke_hook_passed_to_strategy(self, mock_model_instance, mock_context):
        """Test that tool_invoke_hook is passed to the strategy."""
        model_features = [ModelFeature.TOOL_CALL]
        mock_hook = MagicMock()

        strategy = StrategyFactory.create_strategy(
            model_features=model_features,
            model_instance=mock_model_instance,
            context=mock_context,
            tools=[],
            files=[],
            tool_invoke_hook=mock_hook,
        )

        assert strategy.tool_invoke_hook == mock_hook
