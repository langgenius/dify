"""Tests for AgentPattern base class."""

from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from core.agent.entities import AgentLog, ExecutionContext
from core.agent.patterns.base import AgentPattern
from core.model_runtime.entities.llm_entities import LLMUsage


class ConcreteAgentPattern(AgentPattern):
    """Concrete implementation of AgentPattern for testing."""

    def run(self, prompt_messages, model_parameters, stop=[], stream=True):
        """Minimal implementation for testing."""
        yield from []


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
def agent_pattern(mock_model_instance, mock_context):
    """Create a concrete agent pattern for testing."""
    return ConcreteAgentPattern(
        model_instance=mock_model_instance,
        tools=[],
        context=mock_context,
        max_iterations=10,
    )


class TestAccumulateUsage:
    """Tests for _accumulate_usage method."""

    def test_accumulate_usage_to_empty_dict(self, agent_pattern):
        """Test accumulating usage to an empty dict creates a copy."""
        total_usage: dict = {"usage": None}
        delta_usage = LLMUsage(
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

        agent_pattern._accumulate_usage(total_usage, delta_usage)

        assert total_usage["usage"] is not None
        assert total_usage["usage"].total_tokens == 150
        assert total_usage["usage"].prompt_tokens == 100
        assert total_usage["usage"].completion_tokens == 50
        # Verify it's a copy, not a reference
        assert total_usage["usage"] is not delta_usage

    def test_accumulate_usage_adds_to_existing(self, agent_pattern):
        """Test accumulating usage adds to existing values."""
        initial_usage = LLMUsage(
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
        total_usage: dict = {"usage": initial_usage}

        delta_usage = LLMUsage(
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

        agent_pattern._accumulate_usage(total_usage, delta_usage)

        assert total_usage["usage"].total_tokens == 450  # 150 + 300
        assert total_usage["usage"].prompt_tokens == 300  # 100 + 200
        assert total_usage["usage"].completion_tokens == 150  # 50 + 100

    def test_accumulate_usage_multiple_rounds(self, agent_pattern):
        """Test accumulating usage across multiple rounds."""
        total_usage: dict = {"usage": None}

        # Round 1: 100 tokens
        round1_usage = LLMUsage(
            prompt_tokens=70,
            prompt_unit_price=Decimal("0.001"),
            prompt_price_unit=Decimal("0.001"),
            prompt_price=Decimal("0.07"),
            completion_tokens=30,
            completion_unit_price=Decimal("0.002"),
            completion_price_unit=Decimal("0.001"),
            completion_price=Decimal("0.06"),
            total_tokens=100,
            total_price=Decimal("0.13"),
            currency="USD",
            latency=0.3,
        )
        agent_pattern._accumulate_usage(total_usage, round1_usage)
        assert total_usage["usage"].total_tokens == 100

        # Round 2: 150 tokens
        round2_usage = LLMUsage(
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
            latency=0.4,
        )
        agent_pattern._accumulate_usage(total_usage, round2_usage)
        assert total_usage["usage"].total_tokens == 250  # 100 + 150

        # Round 3: 200 tokens
        round3_usage = LLMUsage(
            prompt_tokens=130,
            prompt_unit_price=Decimal("0.001"),
            prompt_price_unit=Decimal("0.001"),
            prompt_price=Decimal("0.13"),
            completion_tokens=70,
            completion_unit_price=Decimal("0.002"),
            completion_price_unit=Decimal("0.001"),
            completion_price=Decimal("0.14"),
            total_tokens=200,
            total_price=Decimal("0.27"),
            currency="USD",
            latency=0.5,
        )
        agent_pattern._accumulate_usage(total_usage, round3_usage)
        assert total_usage["usage"].total_tokens == 450  # 100 + 150 + 200


class TestCreateLog:
    """Tests for _create_log method."""

    def test_create_log_with_label_and_status(self, agent_pattern):
        """Test creating a log with label and status."""
        log = agent_pattern._create_log(
            label="ROUND 1",
            log_type=AgentLog.LogType.ROUND,
            status=AgentLog.LogStatus.START,
            data={"key": "value"},
        )

        assert log.label == "ROUND 1"
        assert log.log_type == AgentLog.LogType.ROUND
        assert log.status == AgentLog.LogStatus.START
        assert log.data == {"key": "value"}
        assert log.parent_id is None

    def test_create_log_with_parent_id(self, agent_pattern):
        """Test creating a log with parent_id."""
        parent_log = agent_pattern._create_log(
            label="ROUND 1",
            log_type=AgentLog.LogType.ROUND,
            status=AgentLog.LogStatus.START,
            data={},
        )

        child_log = agent_pattern._create_log(
            label="CALL tool",
            log_type=AgentLog.LogType.TOOL_CALL,
            status=AgentLog.LogStatus.START,
            data={},
            parent_id=parent_log.id,
        )

        assert child_log.parent_id == parent_log.id
        assert child_log.log_type == AgentLog.LogType.TOOL_CALL


class TestFinishLog:
    """Tests for _finish_log method."""

    def test_finish_log_updates_status(self, agent_pattern):
        """Test that finish_log updates status to SUCCESS."""
        log = agent_pattern._create_log(
            label="ROUND 1",
            log_type=AgentLog.LogType.ROUND,
            status=AgentLog.LogStatus.START,
            data={},
        )

        finished_log = agent_pattern._finish_log(log, data={"result": "done"})

        assert finished_log.status == AgentLog.LogStatus.SUCCESS
        assert finished_log.data == {"result": "done"}

    def test_finish_log_adds_usage_metadata(self, agent_pattern):
        """Test that finish_log adds usage to metadata."""
        log = agent_pattern._create_log(
            label="ROUND 1",
            log_type=AgentLog.LogType.ROUND,
            status=AgentLog.LogStatus.START,
            data={},
        )

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

        finished_log = agent_pattern._finish_log(log, usage=usage)

        assert finished_log.metadata[AgentLog.LogMetadata.TOTAL_TOKENS] == 150
        assert finished_log.metadata[AgentLog.LogMetadata.TOTAL_PRICE] == Decimal("0.2")
        assert finished_log.metadata[AgentLog.LogMetadata.CURRENCY] == "USD"
        assert finished_log.metadata[AgentLog.LogMetadata.LLM_USAGE] == usage


class TestFindToolByName:
    """Tests for _find_tool_by_name method."""

    def test_find_existing_tool(self, mock_model_instance, mock_context):
        """Test finding an existing tool by name."""
        mock_tool = MagicMock()
        mock_tool.entity.identity.name = "test_tool"

        pattern = ConcreteAgentPattern(
            model_instance=mock_model_instance,
            tools=[mock_tool],
            context=mock_context,
        )

        found_tool = pattern._find_tool_by_name("test_tool")
        assert found_tool == mock_tool

    def test_find_nonexistent_tool_returns_none(self, mock_model_instance, mock_context):
        """Test that finding a nonexistent tool returns None."""
        mock_tool = MagicMock()
        mock_tool.entity.identity.name = "test_tool"

        pattern = ConcreteAgentPattern(
            model_instance=mock_model_instance,
            tools=[mock_tool],
            context=mock_context,
        )

        found_tool = pattern._find_tool_by_name("nonexistent_tool")
        assert found_tool is None


class TestMaxIterationsCapping:
    """Tests for max_iterations capping."""

    def test_max_iterations_capped_at_99(self, mock_model_instance, mock_context):
        """Test that max_iterations is capped at 99."""
        pattern = ConcreteAgentPattern(
            model_instance=mock_model_instance,
            tools=[],
            context=mock_context,
            max_iterations=150,
        )

        assert pattern.max_iterations == 99

    def test_max_iterations_not_capped_when_under_99(self, mock_model_instance, mock_context):
        """Test that max_iterations is not capped when under 99."""
        pattern = ConcreteAgentPattern(
            model_instance=mock_model_instance,
            tools=[],
            context=mock_context,
            max_iterations=50,
        )

        assert pattern.max_iterations == 50
