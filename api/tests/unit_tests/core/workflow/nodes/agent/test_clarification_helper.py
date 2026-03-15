"""
Tests for agent node clarification helper and configuration.
"""

import pytest

from core.workflow.nodes.agent.clarification_helper import (
    extract_clarification_request,
    should_enable_clarification,
)
from core.workflow.nodes.agent.entities import AgentNodeData
from dify_graph.enums import NodeType


@pytest.fixture
def base_node_data_args() -> dict:
    """Fixture providing base arguments for AgentNodeData construction."""
    return {
        "id": "test_node",
        "type": NodeType.AGENT,
        "agent_strategy_provider_name": "test_provider",
        "agent_strategy_name": "test_strategy",
        "agent_strategy_label": "Test Strategy",
        "agent_parameters": {},
    }


class TestClarificationHelper:
    """Test suite for clarification helper functions."""

    def test_should_enable_clarification_when_enabled(self, base_node_data_args):
        """Test that should_enable_clarification returns True when enabled."""
        node_data = AgentNodeData(
            **base_node_data_args,
            enable_human_clarification=True,
        )
        assert should_enable_clarification(node_data) is True

    def test_should_enable_clarification_when_disabled(self, base_node_data_args):
        """Test that should_enable_clarification returns False when disabled."""
        node_data = AgentNodeData(
            **base_node_data_args,
            enable_human_clarification=False,
        )
        assert should_enable_clarification(node_data) is False

    def test_should_enable_clarification_default_false(self, base_node_data_args):
        """Test that clarification is disabled by default."""
        node_data = AgentNodeData(**base_node_data_args)
        assert should_enable_clarification(node_data) is False

    def test_extract_clarification_request_when_disabled(self):
        """Test that extract_clarification_request returns None when disabled."""
        result = extract_clarification_request(
            _agent_output={"text": "test output"},
            enable_clarification=False,
        )
        assert result is None

    def test_extract_clarification_request_when_enabled(self):
        """Test that extract_clarification_request returns None when enabled (placeholder)."""
        # Currently returns None as placeholder for future implementation
        result = extract_clarification_request(
            _agent_output={"text": "test output"},
            enable_clarification=True,
        )
        assert result is None

    def test_agent_node_data_with_clarification_field(self, base_node_data_args):
        """Test that AgentNodeData properly stores enable_human_clarification."""
        node_data = AgentNodeData(
            **base_node_data_args,
            enable_human_clarification=True,
        )
        assert node_data.enable_human_clarification is True

        node_data_disabled = AgentNodeData(
            **base_node_data_args,
            enable_human_clarification=False,
        )
        assert node_data_disabled.enable_human_clarification is False
