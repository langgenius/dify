from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import UserFrom
from core.workflow.nodes.tool.tool_node import ToolNode
from models.workflow import WorkflowNodeExecutionStatus


def test_tool_variable_invoke():
    pool = VariablePool(system_variables={}, user_inputs={}, environment_variables=[])
    pool.add(["1", "123", "args1"], "1+1")

    node = ToolNode(
        tenant_id="1",
        app_id="1",
        workflow_id="1",
        user_id="1",
        invoke_from=InvokeFrom.WEB_APP,
        user_from=UserFrom.ACCOUNT,
        config={
            "id": "1",
            "data": {
                "title": "a",
                "desc": "a",
                "provider_id": "maths",
                "provider_type": "builtin",
                "provider_name": "maths",
                "tool_name": "eval_expression",
                "tool_label": "eval_expression",
                "tool_configurations": {},
                "tool_parameters": {
                    "expression": {
                        "type": "variable",
                        "value": ["1", "123", "args1"],
                    }
                },
            },
        },
    )

    # execute node
    result = node.run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert "2" in result.outputs["text"]
    assert result.outputs["files"] == []


def test_tool_mixed_invoke():
    pool = VariablePool(system_variables={}, user_inputs={}, environment_variables=[])
    pool.add(["1", "args1"], "1+1")

    node = ToolNode(
        tenant_id="1",
        app_id="1",
        workflow_id="1",
        user_id="1",
        invoke_from=InvokeFrom.WEB_APP,
        user_from=UserFrom.ACCOUNT,
        config={
            "id": "1",
            "data": {
                "title": "a",
                "desc": "a",
                "provider_id": "maths",
                "provider_type": "builtin",
                "provider_name": "maths",
                "tool_name": "eval_expression",
                "tool_label": "eval_expression",
                "tool_configurations": {},
                "tool_parameters": {
                    "expression": {
                        "type": "mixed",
                        "value": "{{#1.args1#}}",
                    }
                },
            },
        },
    )

    # execute node
    result = node.run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert "2" in result.outputs["text"]
    assert result.outputs["files"] == []
