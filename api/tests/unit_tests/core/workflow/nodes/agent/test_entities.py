import pytest
from pydantic import ValidationError

from core.workflow.nodes.agent.entities import AgentNodeData


def test_agent_input_accepts_variable_selector_and_mixed_values() -> None:
    node_data = AgentNodeData.model_validate(
        {
            "title": "Agent",
            "agent_strategy_provider_name": "provider",
            "agent_strategy_name": "strategy",
            "agent_strategy_label": "Strategy",
            "agent_parameters": {
                "query": {"type": "variable", "value": ["start", "query"]},
                "tools": {"type": "mixed", "value": [{"provider": "builtin", "name": "search"}]},
            },
        }
    )

    assert node_data.agent_parameters["query"].value == ["start", "query"]
    assert node_data.agent_parameters["tools"].value == [{"provider": "builtin", "name": "search"}]


def test_agent_input_rejects_invalid_variable_selector_and_unknown_type() -> None:
    with pytest.raises(ValidationError):
        AgentNodeData.model_validate(
            {
                "title": "Agent",
                "agent_strategy_provider_name": "provider",
                "agent_strategy_name": "strategy",
                "agent_strategy_label": "Strategy",
                "agent_parameters": {"query": {"type": "variable", "value": "start.query"}},
            }
        )

    with pytest.raises(ValidationError, match="Unknown agent input type"):
        AgentNodeData.model_validate(
            {
                "title": "Agent",
                "agent_strategy_provider_name": "provider",
                "agent_strategy_name": "strategy",
                "agent_strategy_label": "Strategy",
                "agent_parameters": {"query": {"type": "unsupported", "value": "hello"}},
            }
        )
