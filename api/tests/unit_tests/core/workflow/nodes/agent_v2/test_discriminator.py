import pytest
from pydantic import ValidationError

from core.workflow.nodes.agent_v2.discriminator import is_dify_agent_node_data
from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
from graphon.entities.base_node_data import BaseNodeData


@pytest.mark.parametrize(
    ("node_data", "expected"),
    [
        ({"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}, True),
        ({"type": "agent", "version": 2, "agent_node_kind": "dify_agent"}, True),
        ({"type": "agent", "version": "2"}, False),
        ({"type": "agent", "version": "1", "agent_node_kind": "dify_agent"}, False),
        ({"type": "llm", "version": "2", "agent_node_kind": "dify_agent"}, False),
    ],
)
def test_is_dify_agent_node_data_mapping(node_data: dict[str, object], expected: bool) -> None:
    assert is_dify_agent_node_data(node_data) is expected


def test_is_dify_agent_node_data_supports_base_node_data() -> None:
    node_data = BaseNodeData.model_validate({"type": "agent", "version": "2", "agent_node_kind": "dify_agent"})

    assert is_dify_agent_node_data(node_data) is True


def test_dify_agent_node_data_requires_explicit_kind_marker() -> None:
    with pytest.raises(ValidationError, match="agent_node_kind"):
        DifyAgentNodeData.model_validate({"type": "agent", "version": "2"})
