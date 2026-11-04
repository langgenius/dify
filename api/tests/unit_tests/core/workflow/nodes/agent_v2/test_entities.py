import pytest
from pydantic import ValidationError

from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData


def test_dify_agent_node_data_requires_explicit_kind_marker() -> None:
    with pytest.raises(ValidationError, match="agent_node_kind"):
        DifyAgentNodeData.model_validate({"type": "agent", "version": "2"})
