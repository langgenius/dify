import pytest

from core.app.app_config.entities import VariableEntity, VariableEntityType
from core.tools.entities.tool_entities import ToolParameter, WorkflowToolParameterConfiguration
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


def test_get_workflow_graph_variables_and_outputs():
    graph = {
        "nodes": [
            {
                "id": "start",
                "data": {
                    "type": "start",
                    "variables": [
                        {
                            "variable": "query",
                            "label": "Query",
                            "type": "text-input",
                            "required": True,
                        }
                    ],
                },
            },
            {
                "id": "end-1",
                "data": {
                    "type": "end",
                    "outputs": [
                        {"variable": "answer", "value_type": "string", "value_selector": ["n1", "answer"]},
                        {"variable": "score", "value_type": "number", "value_selector": ["n1", "score"]},
                    ],
                },
            },
            {
                "id": "end-2",
                "data": {
                    "type": "end",
                    "outputs": [
                        {"variable": "answer", "value_type": "object", "value_selector": ["n2", "answer"]},
                    ],
                },
            },
        ]
    }

    variables = WorkflowToolConfigurationUtils.get_workflow_graph_variables(graph)
    assert len(variables) == 1
    assert variables[0].variable == "query"
    assert variables[0].type == VariableEntityType.TEXT_INPUT

    outputs = WorkflowToolConfigurationUtils.get_workflow_graph_output(graph)
    assert [output.variable for output in outputs] == ["answer", "score"]
    assert outputs[0].value_type == "object"
    assert outputs[1].value_type == "number"

    no_start = WorkflowToolConfigurationUtils.get_workflow_graph_variables({"nodes": []})
    assert no_start == []


def test_check_is_synced_validation():
    variables = [
        VariableEntity(
            variable="query",
            label="Query",
            type=VariableEntityType.TEXT_INPUT,
            required=True,
        )
    ]
    configs = [
        WorkflowToolParameterConfiguration(
            name="query",
            description="desc",
            form=ToolParameter.ToolParameterForm.FORM,
        )
    ]

    WorkflowToolConfigurationUtils.check_is_synced(variables=variables, tool_configurations=configs)

    with pytest.raises(ValueError, match="parameter configuration mismatch"):
        WorkflowToolConfigurationUtils.check_is_synced(variables=variables, tool_configurations=[])

    with pytest.raises(ValueError, match="parameter configuration mismatch"):
        WorkflowToolConfigurationUtils.check_is_synced(
            variables=variables,
            tool_configurations=[
                WorkflowToolParameterConfiguration(
                    name="other",
                    description="desc",
                    form=ToolParameter.ToolParameterForm.FORM,
                )
            ],
        )
