import pytest

from domain.workflow.agent_node import is_dify_agent_node_data
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
