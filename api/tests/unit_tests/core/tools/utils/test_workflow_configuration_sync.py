import pytest

from core.tools.errors import WorkflowToolHumanInputNotSupportedError
from core.tools.utils.workflow_configuration_sync import WorkflowToolConfigurationUtils


def test_ensure_no_human_input_nodes_passes_for_non_human_input():
    graph = {
        "nodes": [
            {
                "id": "start_node",
                "data": {"type": "start"},
            }
        ]
    }

    WorkflowToolConfigurationUtils.ensure_no_human_input_nodes(graph)


def test_ensure_no_human_input_nodes_raises_for_human_input():
    graph = {
        "nodes": [
            {
                "id": "human_input_node",
                "data": {"type": "human-input"},
            }
        ]
    }

    with pytest.raises(WorkflowToolHumanInputNotSupportedError) as exc_info:
        WorkflowToolConfigurationUtils.ensure_no_human_input_nodes(graph)

    assert exc_info.value.error_code == "workflow_tool_human_input_not_supported"
