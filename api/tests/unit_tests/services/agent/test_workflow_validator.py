import pytest

from services.agent.workflow_validator import WorkflowAgentNodeValidator


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
def test_iter_agent_v2_nodes_uses_domain_discriminator(node_data: dict[str, object], expected: bool) -> None:
    """Given graph node data, yield only Dify Agent v2 nodes without rewriting it."""
    graph = {"nodes": [{"id": "agent-node", "data": node_data}]}

    nodes = list(WorkflowAgentNodeValidator.iter_agent_v2_nodes(graph))

    assert nodes == ([("agent-node", node_data)] if expected else [])
    if expected:
        assert nodes[0][1] is node_data
